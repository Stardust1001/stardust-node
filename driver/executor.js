import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Papa from 'papaparse'
import Excel from 'exceljs'
import mammoth from 'mammoth'
import randomUa from 'random-useragent'
import { funcs, highdict, dates, promises } from '@stardust-js/js'
import nodeFuncs from '../funcs.js'
import fsUtils from '../fsUtils.js'
import Storage from '../storage.js'
import Loader from './loader.js'
import Dumper from './dumper.js'
import { parseSelectors, chainLocator, isUrlMatch, onError } from './utils.js'

const COMMANDS_DICT = {
  use: '使用脚本',
  callBot: '调用脚本',
  execute: '批量执行命令',
  ui: '批量执行命令(前端)',
  progress: '进度',
  report: '汇报',
  reportTable: '汇报表格',
  new: '创建新执行器',
  goto: '打开网址',
  reload: '刷新网页',
  waitFor: '等待元素',
  waitOr: '等待任意一个元素',
  waitForURL: '等待网址',
  waitForFunction: '等待条件成立',
  waitForLoadState: '等待网页刷新',
  waitForNext: '等待下一步',
  sleep: '等待',
  blur: '鼠标移出',
  clear: '清空',
  click: '点击',
  dblclick: '双击',
  dragTo: '拖拽',
  eval: '执行代码(eval)',
  fill: '填写输入框',
  focus: '元素聚焦',
  hover: '鼠标悬浮',
  press: '按键',
  select: '下拉框选择',
  upload: '上传文件',
  screenshot: '截图',
  accept: '确定弹框',
  filechoose: '文件选择',
  dismiss: '取消弹框',
  follow: '跟随跳转',
  jump: '跳转',
  mouse: '鼠标',
  keyboard: '按键',
  enter: '回车',
  withFrame: '进入iframe',
  if: '如果(if)',
  elseIf: '另外(elseIf)',
  else: '否则(else)',
  switch: '条件判断',
  for: '循环(指定次数)',
  while: '循环(当)',
  dynamic: '动态执行',
  func: '执行代码(func)',
  prompt: '提示输入',
  fillOcr: 'OCR识别填写',
  autogui: '执行电脑自动化',
  save: '保存文件',
  pick: '选取内容',
  title: '修改标签页名称',
  comment: '注释',
  load: '加载文件',
  useFront: '自定义网页内容',
  useForm: '表单',
  close: '关闭网页'
}

export class Executor {
  constructor (driver, browser, context, config = {}) {
    this.driver = driver
    this.browser = browser
    this.context = context
    this.config = config
    this.executors = []
    this.page = config.page
    this.topPage = config.topPage || config.page
    this.isNewed = config.isNewed
    this.emitter = this.config.emitter
    this.cache = null
    this.log = config.log || console.log

    this.libs = {
      fs,
      path,
      crypto,
      Papa,
      Excel,
      mammoth,
      randomUa
    }
    this.utils = {
      funcs,
      highdict,
      dates,
      fsUtils,
      nodeFuncs,
      promises,
      ...nodeFuncs,
      ...funcs,
      ...highdict,
      ...dates,
      ...fsUtils,
      ...promises,
      Loader,
      Dumper
    }

    this.isExcuting = false
    this._state = {}
    this._ifs = []
    this._initialBot = this.config
    this._currentBot = this.config
    this._waitFailed = false
    this._maskStyle = `
      position: fixed;
      z-index: 999998;
      width: 100vw;
      height: 100vh;
      left: 0;
      top: 0;
      background-color: rgba(0, 0, 0, 0.3);
      pointer-events: none;
    ` + (config.maskStyle || '')
    this._autogui = null
    this.init()
  }

  async init () {
    this.isPlaying = true
    this.emitter.on('pause', () => {
      this.isPlaying = false
      this.emitter.emit('paused')
    })
    this.emitter.on('hover', () => {
      if (this.topPage && !this.topPage.isClosed()) {
        this.topPage.bringToFront()
      }
    })
    this._onPageClose = () => {
      if (this.isNewed) return
      this.emitter.emit('closed')
    }
    this.page?.once('close', this._onPageClose)
    try {
      await this.beforeInit?.()
    } catch (err) {
      onError(err, this, 'executor beforeInit')
    }
    const { storageDir, org, name } = this.config
    const dir = path.join(storageDir, org)
    await fsUtils.mkdir(dir)
    this.cache = new Storage({
      filepath: path.join(dir, name + '.json'),
      autoLoad: true,
      autoSave: false
    })
    try {
      await this.afterInit?.()
    } catch (err) {
      onError(err, this, 'executor afterInit')
    }
  }

  get safeThis () {
    return new Proxy(this, {
      get (obj, property) {
        if (['driver', 'browser', 'context'].includes(property)) return null
        return obj[property]
      }
    })
  }

  async use (code, props) {
    const { meta, operations } = await this.driver.getBot(this, code, props)
    this._currentBot = meta
    await this.execute(operations, 'use')
  }

  async callBot (code, options) {
    const [org, name] = code.split('=')
    const url = this.config.apiUrl + '/bots/call'
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        org,
        name,
        ...options
      })
    })
  }

  async execute (operations, source, ...props) {
    try {
      await this.beforeExecute?.(operations, source, ...props)
    } catch (err) {
      onError(err, this, 'beforeExecute')
    }
    const execTypes = [
      'if', 'elseIf', 'else', 'switch',
      'for', 'while',
      'dynamic', 'withFrame',
      'accept', 'dismiss',
      'waitForLoadState', 'follow'
    ]
    const lastState = { ...this._state }
    for (let i = 0, len = operations.length; i < len; i++) {
      if (!this.isPlaying) {
        await this._waitContinue()
      }
      const ele = operations[i]
      this.emitter.emit('progress', {
        index: i, operation: ele,
        type: COMMANDS_DICT[ele[0]] || '其他操作'
      })
      Object.assign(this._state, {
        lastIndex: i - 1,
        currentIndex: i,
        nextIndex: i + 1,
        last: operations[i - 1],
        current: ele,
        next: operations[i + 1]
      })
      const args = [...ele.slice(1)]
      if ([...execTypes, 'func', 'comment'].includes(ele[0])) {
        args.push(...props)
      }
      try {
        await this[ele[0]](...args)
      } catch (err) {
        return onError(err, this, 'execute')
      }
    }
    this._state = lastState
    this.cache.save()
    try {
      await this.afterExecute?.(operations, source, ...props)
    } catch (err) {
      onError(err, this, 'afterExecute')
    }
  }

  async ui (operations, options) {
    options = {
      interval: 10,
      slow: 10,
      ...options
    }
    await this.eval(({ operations, options }) => {
      if (typeof operations === 'string') {
        operations = window.eval(operations)
      }
      return new StardustBrowser.UIExecutor(options).execute(operations, options)
    }, { operations, options })
  }

  async progress (title, percent) { }

  async report (title, percent, options = {}, isDone = false) {
    if (typeof title === 'function') {
      title = await title(this.safeThis)
    }
    return this.ui(`[
      ['report', \`${title}\`, ${percent}, ${JSON.stringify(options)}, ${isDone}]
    ]`)
  }

  async reportTable (options = {}) {
    if (typeof options === 'function') {
      options = await options(this.safeThis)
    }
    return this.ui(`[
      ['reportTable', ${JSON.stringify(options)}]
    ]`)
  }

  async new () {
    const newPage = await this.context.newPage()
    const { page, topPage } = this.config
    Object.assign(this.config, { page: newPage, topPage: this.topPage, isNewed: true })
    const executor = new this.config.Executor(this.driver, this.browser, this.context, this.config)
    Object.assign(this.config, { page, topPage, isNewed: false })
    this.executors.push(executor)
    return executor
  }

  async goto (url, options) {
    const hasUrl = !!url
    url ||= this.config.homeUrl + '/blank/index.html'
    if (!this.page) {
      this.page = await this.context.newPage()
      this.page.once('close', this._onPageClose)
      try {
        await this.afterNewPage?.(this.page, url, options)
      } catch (err) {
        onError(err, this, 'afterNewPage')
      }
    }
    if (!this.topPage || this.topPage.isClosed()) this.topPage = this.page
    try {
      await this.beforeGoto?.(url, options)
    } catch (err) {
      onError(err, this, 'beforeGoto')
    }
    await this.page.goto(url, options)
    try {
      await this.afterGoto?.(url, options)
    } catch (err) {
      onError(err, this, 'afterGoto')
    }
    if (!hasUrl) {
      await this.eval(`$one('#app').remove()`)
    }
  }

  async reload (options) {
    options = {
      ignoreError: true,
      timeout: 1e9,
      ...options
    }
    try {
      await this.beforeReload?.(options)
    } catch (err) {
      onError(err, this, 'beforeReload')
    }
    await this.page.reload(options).then(() => {
      this._waitFailed = false
    }).catch(err => {
      this._waitFailed = true
      if (!options.ignoreError) onError(err, this, 'reload')
    })
    try {
      await this.afterReload?.(options)
    } catch (err) {
      onError(err, this, 'afterReload')
    }
  }

  wait (name, ...props) {
    const last = props[props.length - 1]
    if (typeof last === 'object' && last.timeout === undefined) {
      last.timeout = 1e9
    }
    return this.page['wait' + name](...props)
  }

  async waitFor (selector, options = {}) {
    options.state ??= 'visible'
    options.timeout ??= 1e9
    options = {
      ignoreError: true,
      ...options
    }
    let loc = this.locator(selector, options)
    await loc.waitFor(options).then(() => {
      this._waitFailed = false
    }).catch(err => {
      loc = null
      this._waitFailed = true
      if (!options.ignoreError) onError(err, this, 'waitFor')
    })
    options.force ??= true
    return loc
  }

  waitOr (selectors, options) {
    options = {
      timeout: 1e9,
      ...options
    }
    let loc = this.locator(selectors[0], options)
    for (let i = 1; i < selectors.length; i++) {
      loc = loc.or(this.locator(selectors[i], options))
    }
    return loc.waitFor(options)
  }

  waitForURL (url, options) {
    options = {
      ignoreError: true,
      timeout: 1e9,
      ...options
    }
    return this.page.waitForURL(url, options).then(() => {
      this._waitFailed = false
    }).catch(err => {
      this._waitFailed = true
      if (!options.ignoreError) onError(err, this, 'waitForURL')
    })
  }

  waitForEvent (event, optionsOrPredicate, options) {
    options = {
      ignoreError: true,
      timeout: 1e9,
      ...options
    }
    return this.page.waitForEvent(event, optionsOrPredicate, options).then(() => {
      this._waitFailed = false
    }).catch(err => {
      this._waitFailed = true
      if (!options.ignoreError) onError(err, this, 'waitForEvent')
    })
  }

  waitForFunction (func, args, options) {
    options = {
      ignoreError: true,
      timeout: 1e9,
      ...options
    }
    if (typeof func === 'string') {
      func = `try { ${func} } catch { }`
    }
    return this.page.waitForFunction(func, args, options).then(() => {
      this._waitFailed = false
    }).catch(err => {
      this._waitFailed = true
      if (!options.ignoreError) onError(err, this, 'waitForFunction')
    })
  }

  waitForLoadState (state, operations, options) {
    options = {
      ignoreError: true,
      timeout: 1e9,
      ...options
    }
    const ps = []
    if (Array.isArray(operations)) {
      ps.push(this.execute(operations, 'waitForLoadState', options))
    }
    const p = this.page.waitForLoadState(state || 'domcontentloaded', options).then(() => {
      this._waitFailed = false
    }).catch(err => {
      this._waitFailed = true
      if (!options.ignoreError) onError(err, this, 'waitForLoadState')
    })
    ps.push(p)

    return Promise.all(ps)
  }

  async waitForNext (title = '下一步', options = {}) {
    return this.ui(`[
      ['waitForNext', \`${title}\`, ${JSON.stringify(options)}]
    ]`)
  }

  sleep (ms) {
    return funcs.sleep(ms)
  }

  locator (selector, options) {
    options = {
      timeout: 1e9,
      ...options
    }
    const selectors = parseSelectors(selector)
    let loc
    for (const ele of selectors) {
      let str = ele
      let op = { ...options }
      if (Array.isArray(ele)) {
        str = ele[0]
        Object.assign(op, ele[1])
      }
      if (op.frame) {
        loc = this.page.frameLocator(op.frame, op)
      } else {
        loc = this.page
      }
      if (str) {
        loc = loc.locator(str, options)
      }
      loc = chainLocator(loc, op)
    }
    return loc
  }

  by (what, value, options) {
    return this.page['get' + what](value, options)
  }

  async blur (selector, options = {}) {
    return (await this.waitFor(selector, options))?.blur(options)
  }

  async box (selector, options = {}) {
    return (await this.waitFor(selector, options))?.boundingBox(options)
  }

  async checkFor (selector, options = {}) {
    return (await this.waitFor(selector, options))?.check(options)
  }

  async uncheckFor (selector, options = {}) {
    return (await this.waitFor(selector, options))?.uncheck(options)
  }

  async clear (selector, options = {}) {
    return (await this.waitFor(selector, options))?.clear(options)
  }

  async click (selector, options = {}) {
    return (await this.waitFor(selector, options))?.click(options)
  }

  async count (selector, options = {}) {
    return (await this.waitFor(selector, options))?.count(options)
  }

  async dblclick (selector, options = {}) {
    return (await this.waitFor(selector, options))?.dblclick(options)
  }

  async dragTo (selector, targetSelector, options = {}) {
    return (await this.waitFor(selector, options))?.dragTo(this.locator(targetSelector), options)
  }

  eval (func, args = {}) {
    return (args.page || this.page).evaluate(func, args)
  }

  async evalOn (selector, func, options = {}) {
    if (typeof func === 'string') {
      func = eval('node => ' + func)
    }
    return (await this.waitFor(selector, options))?.evaluate(func, options)
  }

  async evalOnAll (selector, func, options = {}) {
    return (await this.waitFor(selector, options))?.evaluateAll(func, options)
  }

  async evaluateHandle (selector, func, args, options = {}) {
    return (await this.waitFor(selector, options))?.evaluateHandle(func, args, options)
  }

  async set (selector, attr, value, bySetter = false) {
    if (typeof value === 'function') {
      value = await this.eval(value)
    }
    return this.eval(`
      const node = $one(\`${selector}\`)
      const value = eval(\`${value}\`)
      if (${bySetter}) {
        node.setAttribute(\`${attr}\`, value)
      } else {
        node[\`${attr}\`] = value
      }
    `)
  }

  async fill (selector, value, options = {}) {
    return (await this.waitFor(selector, options))?.fill(value.toString(), options)
  }

  async type (selector, value, options = {}) {
    return (await this.waitFor(selector, options))?.type(value, options)
  }

  async focus (selector, options = {}) {
    return (await this.waitFor(selector, options))?.focus(options)
  }

  async hover (selector, options = {}) {
    return (await this.waitFor(selector, options))?.hover(options)
  }

  async press (selector, keys, options = {}) {
    options = {
      interval: 20,
      ...options
    }
    keys = Array.isArray(keys) ? keys : [keys]
    const loc = await this.waitFor(selector, options)
    if (!loc) return
    for (let key of keys) {
      loc.press(key, options)
      await this.sleep(options.interval)
    }
  }

  async tap (selector, options = {}) {
    return (await this.waitFor(selector, options))?.tap(options)
  }

  async select (selector, value, options = {}) {
    return (await this.waitFor(selector, options))?.selectOption(value, options)
  }

  async check (selector, value, options = {}) {
    return (await this.waitFor(selector, options))?.setChecked(value, options)
  }

  async upload (selector, value, options = {}) {
    return (await this.waitFor(selector, options))?.setInputFiles(value, options)
  }

  async screenshot (selector, options = {}) {
    return (await this.waitFor(selector, options))?.screenshot(options)
  }

  async accept (value, operations) {
    this.topPage._dialog_ = { accept: true }
    const [dialog] = await Promise.all([
      new Promise(resolve => {
        this.topPage.once('dialog', resolve)
      }),
      this.execute(operations, 'accept')
    ])
    if (this.topPage._dialog_) {
      return dialog.accept(value)
    }
  }

  async filechoose (file, operations) {
    const chooserPromise = this.page.waitForEvent('filechooser')
    await this.execute(operations, 'filechoose')
    const chooser = await chooserPromise
    await chooser.setFiles(file)
  }

  async dismiss (operations) {
    this.topPage._dialog_ = { dismiss: true }
    const [dialog] = await Promise.all([
      new Promise(resolve => {
        this.topPage.once('dialog', resolve)
      }),
      this.execute(operations, 'dismiss')
    ])
    if (this.topPage._dialog_) {
      return dialog.dismiss()
    }
  }

  async follow (operations, options = {}) {
    const [page] = await Promise.all([
      this.context.waitForEvent('page', options),
      this.execute(operations, 'follow')
    ])
    this.page.off('close', this._onPageClose)
    await this.page.close()
    this.page = page
    if (!this.topPage || this.topPage.isClosed()) this.topPage = this.page
    this.page.once('close', this._onPageClose)
    await this.waitForLoadState()
  }

  async jump (func, options) {
    let url
    if (typeof func === 'function') {
      url = await func(this)
    } else {
      func = func.toString()
      url = await this.eval(func, options)
    }
    return this.goto(url, options)
  }

  mouse (method, x, y) {
    return this.page.mouse[method](x, y)
  }

  async keyboard (method, keys) {
    keys = Array.isArray(keys) ? keys : [keys]
    for (let key of keys) {
      await this.page.keyboard[method](key)
    }
  }

  enter () {
    return this.keyboard('press', 'Enter')
  }

  async view (selector, options = {}) {
    return (await this.waitFor(selector, options))?.scrollIntoViewIfNeeded(options)
  }

  async attr (selector, name, options = {}) {
    return (await this.waitFor(selector, options))?.getAttribute(name, options)
  }

  async call (selector, method, options = {}) {
    return (await this.waitFor(selector, options))?.[method](options)
  }

  async html (selector, options = {}) {
    return (await this.waitFor(selector, options))?.innerHTML(options)
  }

  async text (selector, options = {}) {
    return (await this.waitFor(selector, options))?.innerText(options)
  }

  async content (selector, options) {
    return (await this.waitFor(selector))?.textContent(options)
  }

  async withFrame (selector, operations, options = {}) {
    options = {
      interval: 20,
      ...options
    }
    let frame
    while (!frame) {
      frame = this.page.frame(selector, options)
      if (frame) break
      await funcs.sleep(options.interval)
    }
    const { page, topPage } = this.config
    Object.assign(this.config, { page: frame, topPage: this.topPage })
    const executor = new this.config.Executor(this.driver, this.browser, this.context, this.config)
    Object.assign(this.config, { page, topPage })
    executor._initialBot = this._initialBot
    await frame.waitForLoadState()
    return executor.execute(operations, 'withFrame')
  }

  async if (func, operations, ...props) {
    this._ifs.push(false)
    let ok
    if (typeof func === 'function') {
      ok = await func(this.safeThis, ...props)
    } else {
      ok = await this.page.evaluate(func)
    }
    if (ok) {
      if (typeof operations === 'function') {
        operations = await operations(this.safeThis, ...props)
      }
      await this.execute(operations, 'if', ...props)
    }
    this._ifs[this._ifs.length - 1] = ok
    if (!['elseIf', 'else'].includes(this._state.next?.[0])) {
      this._ifs.pop()
    }
  }

  async elseIf (func, operations, ...props) {
    if (this._ifs[this._ifs.length - 1]) return
    let ok
    if (typeof func === 'function') {
      ok = await func(this.safeThis, ...props)
    } else {
      ok = await this.page.evaluate(func)
    }
    if (ok) {
      if (typeof operations === 'function') {
        operations = await operations(this.safeThis, ...props)
      }
      await this.execute(operations, 'elseIf', ...props)
    }
    this._ifs[this._ifs.length - 1] = ok
    if (!['elseIf', 'else'].includes(this._state.next?.[0])) {
      this._ifs.pop()
    }
  }

  async else (operations, ...props) {
    if (this._ifs[this._ifs.length - 1]) return
    if (typeof operations === 'function') {
      operations = await operations(this.safeThis, ...props)
    }
    await this.execute(operations, 'else', ...props)
    this._ifs.pop()
  }

  async switch (value, cases, ...props) {
    if (typeof value === 'function') {
      value = await value(this.safeThis, ...props)
    }
    for (let [caseValue, operations] of cases) {
      if (typeof caseValue === 'function') {
        caseValue = await caseValue(this.safeThis, ...props)
      }
      caseValue = Array.isArray(caseValue) ? caseValue : [caseValue]
      if (caseValue.includes(value)) {
        await this.execute(operations, 'switch', ...props)
        return
      }
    }
    const last = cases[cases.length - 1]
    if (last[0] === 'default') {
      await this.execute(last[1], 'switch', ...props)
    }
  }

  async promiseAll (operations) {
    if (typeof operations === 'function') {
      operations = await operations(this.safeThis)
    }
    return Promise.all(operations.map(ele => {
      return this[ele[0]](...ele.slice(1)).catch(err => onError(err, this, 'promiseAll'))
    }))
  }

  async promiseRace (operations) {
    if (typeof operations === 'function') {
      operations = await operations(this.safeThis)
    }
    return Promise.race(operations.map(ele => {
      return this[ele[0]](...ele.slice(1)).catch(err => onError(err, this, 'promiseRace'))
    }))
  }

  async promiseAny (operations) {
    if (typeof operations === 'function') {
      operations = await operations(this.safeThis)
    }
    return Promise.any(operations.map(ele => {
      return this[ele[0]](...ele.slice(1)).catch(err => onError(err, this, 'promiseAny'))
    }))
  }

  async for (func, operations, ...props) {
    let items = func
    if (typeof func === 'function') {
      items = await func(this.safeThis, ...props)
    }
    if (typeof items === 'number') {
      items = Array.from({ length: items }).map((_, i) => i)
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let ops = operations
      if (typeof operations === 'function') {
        ops = await operations(this.safeThis, item, i, ...props)
      }
      await this.execute(ops, 'for', [item, i], ...props)
    }
  }

  async while (func, operations, options) {
    options = {
      inPage: true,
      ...options
    }
    if (typeof func === 'string') {
      func = `try { ${func} } catch { }`
    }
    let i = 0
    while (true) {
      let ok = false
      if (typeof func === 'function' && !options.inPage) {
        ok = await func(this.safeThis)
      } else {
        ok = await this.page.evaluate(func)
      }
      if (!ok) break
      let ops = operations
      if (typeof operations === 'function') {
        ops = await operations(this.safeThis, i++)
      }
      await this.execute(ops, 'while')
    }
  }

  async dynamic (func, ...props) {
    const operations = await func(this, ...props)
    await this.execute(operations, 'dynamic', ...props)
  }

  func (fun, ...props) {
    return fun(this.safeThis, ...props)
  }

  reserveDialog (options) {
    options = {
      once: true,
      timeout: 1e9,
      ...options
    }
    this.topPage[options.once ? 'once' : 'on']('dialog', async dialog => {
      dialog._dismiss = dialog.dismiss
      dialog.dismiss = () => Promise.resolve()
      if (options.timeout !== 1e9) {
        await this.sleep(options.timeout)
        dialog.dismiss = dialog._dismiss
        dialog.dismiss().catch(Function())
      }
    })
  }

  async prompt (selector, options) {
    this.reserveDialog({ once: true })
    options = {
      placeholder: '请输入验证码',
      ...options
    }
    const text = await this.eval(`window.prompt(\`${options.placeholder}\`)`, options)
    await this.fill(selector, text, options)
  }

  async fillOcr (selector, imgSelector, options) {
    const { ocrCaptchaUrl } = this.config
    if (ocrCaptchaUrl) {
      const base64 = await this.eval(`webot.funcs.img2Base64(\`${imgSelector}\`)`, options)
      const data = await fetch(ocrCaptchaUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: base64 })
      }).then(res => res.json())
      return this.fill(selector, data.text, options)
    }
    return this.prompt(selector, options)
  }

  async autogui (operations, options = {}) {
    const autoguiUrl = options.autoguiUrl ?? this.config.autoguiUrl
    if (!autoguiUrl) throw '没有配置桌面自动化服务的网址'
    this._autogui ||= {
      baseURL: autoguiUrl,
      async fetch (url, options = {}) {
        options.headers ||= {}
        options.headers['content-type'] = 'application/json'
        if (options.params) {
          url += funcs.encodeQuery(options.params)
        }
        if (options.body) {
          options.method ??= 'POST'
          if (typeof options.body !== 'string') {
            options.body = JSON.stringify(options.body)
          }
        }
        options.method ??= 'GET'
        const res = await fetch(autoguiUrl + url, options)
        return res.json()
      },
      async execute (operations) {
        const data = await this.fetch('/execute', { body: { operations } })
        return data.data
      },
      async find_window (class_name, window_name) {
        const data = await this.fetch('/find_window', { body: { class_name, window_name } })
        return data.data
      },
      async get_window_rect (handle) {
        const data = await this.fetch('/get_window_rect', { body: { handle } })
        return data.data
      }
    }
    if (operations.length) {
      return this._autogui.execute(operations)
    }
  }

  async save (data, saveTo, key, options) {
    if (typeof options === 'function') {
      options = await options(this.safeThis)
    }
    options = { comment: true, ...options }
    if (typeof data === 'function') {
      data = await data(this.safeThis)
    }
    if (typeof saveTo === 'object') {
      highdict.set(saveTo, key, data)
      return saveTo
    }
    if (!path.isAbsolute(saveTo)) {
      const dirname = options.dirname || path.join(this.config.tempDir, crypto.randomUUID())
      await fsUtils.mkdir(dirname)
      saveTo = path.join(dirname, path.basename(saveTo))
    }
    const name = path.basename(saveTo)
    const format = options.format || Loader.getFileType(saveTo)
    await Dumper[format](data, saveTo, options)
    if (options.comment) {
      this.log({
        type: 'link',
        name,
        link: this.config.apiUrl + '/' + path.relative(this.config.staticDir, saveTo),
        download: path.basename(saveTo)
      })
    }
    return saveTo
  }

  async pick (func, ...props) {
    let value
    if (typeof func === 'function') {
      value = await func(this.safeThis)
    } else{
      value = await this.eval(func)
    }
    if (props.length) {
      return this.save(value, ...props)
    }
    return value
  }

  async pickList (optionsOrFunc, ...props) {
    let list = []
    if (typeof optionsOrFunc === 'object') {
      const fields = optionsOrFunc.fields.map(ele => {
        if (typeof ele === 'object') return ele
        const [prop, selector, type] = ele.split('::')
        return { prop, selector, type }
      })
      list = await this.eval(`
        const fields = ${JSON.stringify(fields)}
        $all(\`${optionsOrFunc.each}\`).map(n => {
          const item = {}
          fields.forEach(field => {
            const value = n.$one(field.selector)?._text()
            item[field.prop] = field.type === 'number' ? parseFloat(value) : value
          })
          return item
        })
      `)
    } else {
      list = await this.eval(optionsOrFunc)
    }
    if (props.length) {
      return this.save(list, ...props)
    }
    return list
  }

  title (title, options) {
    options = { resetable: false, ...options }
    return this.eval(`
      document.title = \`${title}\`
      if (!${options.resetable}) {
        Object.defineProperty(document, 'title', {
          get: () => \`${title}\`,
          set: () => true
        })
      }
    `)
  }

  async comment (message, options, ...props) {
    options = { top: true, ...options }
    if (typeof message === 'function') {
      message = await message(this.safeThis, ...props)
    }
    const page = options.top ? (this.topPage || this.page) : this.page
    if (page && !this.config.headless) {
      if (page.isClosed()) return
      try {
        if (!await page.evaluate('!!window.shiki')) {
          await page.addScriptTag({
            url: `${this.config.homeUrl}/lib/shiki.min.js`
          })
        }
        if (!await page.evaluate('!!window.shikiHighlighter')) {
          await page.evaluate(`
            shiki.setCDN(\`${this.config.homeUrl}/lib/shiki\`);
            new Promise(async resolve => {
              window.shikiHighlighter = await shiki.getHighlighter({
                theme: 'material-theme-palenight',
                langs: ['js', 'json', 'sh']
              })
              resolve()
            })
          `)
        }
        await page.evaluate(([message, options, apiUrl]) => {
          const lang = typeof message === 'object' ? 'json' : 'sh'
          let html
          if (lang === 'json') {
            if (message.type === 'link') {
              html = `
                <a
                  target="_blank"
                  href="${message.link}"
                  download="${message.link}"
                >
                  附件：${message.name}
                </a>
              `
            } else if (message.type === 'html') {
              html = message.html
            } else {
              html = window.shikiHighlighter.codeToHtml(JSON.stringify(message, null, 2), { lang })
            }
          } else {
            html = window.shikiHighlighter.codeToHtml(message, { lang })
          }
          const node = document.createElement('div')
          node.innerHTML = html
          node.style.overflowX = 'auto'
          node.style.cssText += options.cssText
          const pre = node.querySelector('pre')
          if (pre) {
            pre.style.margin = '1px 2px'
            pre.style.padding = '10px'
            if (options.backgroundColor) {
              node.style.backgroundColor = options.backgroundColor
              pre.style.backgroundColor = options.backgroundColor
            }
          } else {
            node.style.padding = '10px'
          }
          document.body.appendChild(node)
          document.body.scrollBy(0, 1000)
          document.documentElement.scrollBy(0, 2000)
        }, [message, options, this.config.apiUrl])
      } catch (err) {
        const message = '[Error]:' + (err?.stack || err?.message || err).toString()
        this.log(message, { backgroundColor: 'red' })
      }
    }
    this.log(message, options)
  }

  async log (message, options, ...props) {
    options = { ...options }
    if (typeof message === 'function') {
      message = await message(this.safeThis, ...props)
    }
    this.log(message, options)
  }

  async load (filepath, options, ...props) {
    options = { ...options }
    if (typeof filepath === 'function') {
      filepath = await filepath(this.safeThis)
    }
    if (!await fsUtils.exists(filepath)) {
      throw '文件不存在: ' + filepath
    }
    const extname = path.extname(filepath).toLowerCase()
    if (['.xls', '.doc', '.ppt'].includes(extname)) {
      throw '不支持 ' + extname + ' 文件，请另存为 ' + extname + 'x 文件'
    }
    const type = options.type || Loader.getFileType(filepath)
    const content = await Loader[type](filepath, options)
    if (props.length) {
      return this.save(content, ...props)
    }
    return content
  }

  async fetch (urlOrList, options, transformer, ...props) {
    options = { limit: 10, ...options }
    if (typeof urlOrList === 'function') {
      urlOrList = await urlOrList(this.safeThis)
    }
    const isArray = Array.isArray(urlOrList)
    urlOrList = isArray ? urlOrList : [[urlOrList, options]]

    const list = await promises.schedule(async (i) => {
      const ele = urlOrList[i]
      const url = ele[0]
      const op = { ...options, ...ele[1] }
      const { type = 'json' } = op
      if (!op.headers?.['User-Agent']) {
        op.headers['User-Agent'] = randomUa.getRandom()
      }
      let data = await fetch(url, op).then(res => res[type]())
      transformer = op.transformer || transformer
      if (transformer) {
        data = await transformer(data, ele, index)
      }
      return data
    }, urlOrList.length, options.limit)

    const result = isArray ? list : list[0]
    if (props.length) {
      return this.save(result, ...props)
    }
    return result
  }

  async useFront (code, options, ...props) {
    options = { ...options }
    const name = await this.eval(`
      const mask = document.createElement('div')
      mask.id = 'webot-mask'
      mask.style.cssText += \`
        ${this._maskStyle}
        ${options.maskStyle || ''}
      \`
      document.body.appendChild(mask)
      const iframe = document.createElement('iframe')
      iframe.id = 'blank-' + Date.now().toString(16)
      iframe.name = iframe.id
      iframe.style.cssText += \`
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 100%;
        height: 100%;
        display: block;
        border: 0;
        outline: 0;
        z-index: 999999;
        background-color: white;
        box-shadow: 10px 10px 20px 20px rgba(0, 0, 0, 0.2);
        pointer-events: auto;
        border-radius: 10px;
        ${options.iframeStyle || ''}
      \`
      iframe.src = \`${this.config.homeUrl}/blank/index.html\`
      mask.appendChild(iframe)
      document.body.appendChild(mask)
      iframe.name
    `)
    await this.waitFor('#' + name)
    let frame
    while (true) {
      frame = this.page.frame(name)
      if (frame) break
      await funcs.sleep(20)
    }
    await frame.waitForLoadState()
    const result = await frame.evaluate(code).then(result => {
      this.eval(`$one(\`#${name}\`).parentNode.remove()`)
      return result
    }).catch(() => null)
    if (props.length) {
      return this.save(result, ...props)
    }
    return result
  }

  async useUpload (options, ...props) {
    options = { ...options }
    let result = await this.useFront(`
      new Promise(resolve => {
        window.app.component('frontpage', {
          template: \`
            <div>${options.title}</div>
            <br>
            <x-file-uploader
              v-model="files"
              multiple
              need-upload
              accept="options.accept"
              v-bind="options"
            />
          \`,
          data () {
            return {
              options: ${JSON.stringify(options)},
              action: \`${this.config.apiUrl}/upload\`,
              files: []
            }
          },
          watch: {
            files () {
              if (this.files.length) resolve(this.files)
            }
          }
        })
        window.frontReady()
      })
    `, options)
    result = result.map(ele => path.join(this.config.staticDir, new URL(ele).pathname))
    if (props.length) {
      return this.save(result, ...props)
    }
    return result
  }

  async useForm (fields, options, ...props) {
    options = { ...options }
    return this.useFront(`
      const fields = ${JSON.stringify(fields)}
      const options = ${JSON.stringify(options)}
      const { CrudController, baseForm, initForm } = StardustUI
      class Controller extends CrudController {

      }
      new Promise(resolve => {
        window.app.component('frontpage', {
          template: \`
            <x-form v-bind="options" :form="form" />
            <div class="operations">
              <el-button v-if="options.cancelable !== false" type="warning" @click="cancel">取消</el-button>
              <el-button type="primary" @click="submit">确定</el-button>
            </div>
          \`,
          data () {
            return {
              form: baseForm(),
              options,
              controller: null
            }
          },
          created () {
            this.controller = new Controller({ model: this })
            initForm(this.form, fields)
            const defaults = {}
            fields.forEach(f => {
              if ('defaultValue' in f) {
                defaults[f.prop] = f.defaultValue
              }
            })
            Object.assign(this.form.form, defaults)
          },
          methods: {
            cancel () {
              resolve(null)
            },
            async submit () {
              if (!await this.controller._validateForm(this.form.formRef)) {
                return
              }
              resolve(this.form.form)
            }
          }
        })
        window.frontReady()
      })
    `, options, ...props)
  }

  async assert (func, message) {
    const ok = await (typeof func === 'function' ? func(this.safeThis) : this.eval(func))
    if (ok) {
      return this.comment('断言失败: ' + message)
    }
    return funcs.sleep(Number.MAX_SAFE_INTEGER)
  }

  onRequest (urlPattern, handler, once = false, context = false) {
    const route = this._interceptNetwork(context)
    route.reqListeners.push([urlPattern, handler, once])
  }

  onResponse (urlPattern, handler, once = false, context = false) {
    const route = this._interceptNetwork(context)
    route.resListeners.push([urlPattern, handler, once])
  }

  _interceptNetwork (context = false) {
    const host = context && this.context || this.page
    if (host._route) return host._route
    host._route = {
      reqListeners: [],
      resListeners: []
    }
    host.route('**/**', async (route, request) => {
      const url = request.url()
      let options = {}
      for (let listener of host._route.reqListeners) {
        const [pattern, handler, once] = listener
        if (isUrlMatch(url, pattern)) {
          options = await handler(request, this.safeThis)
          if (once) listener.done = true
        }
      }
      options ||= {}
      host._route.reqListeners = host._route.reqListeners.filter(l => !l.done)
      options.headers ||= request.headers()
      options.method ||= request.method()
      options.postData ||= request.postData()
      options.url ||= url
      const response = await route.fetch(options)
      let result = {}
      for (let listener of host._route.resListeners) {
        const [pattern, handler, once] = listener
        if (isUrlMatch(url, pattern)) {
          result = await handler(response, this.safeThis)
          if (once) listener.done = true
        }
      }
      result ||= {}
      host._route.resListeners = host._route.resListeners.filter(l => !l.done)
      result.body ||= await response.body()
      result.headers ||= response.headers()
      return route.fulfill({ response, ...result })
    })
    return host._route
  }

  async close () {
    try {
      await this.beforeClose?.()
    } catch (err) {
      onError(err, this, 'beforeClose')
    }
    await Promise.all(this.executors.map(e => e.page?.close()?.catch(Function())))
    await this.page.close()
    try {
      await this.afterClose?.()
    } catch (err) {
      onError(err, this, 'afterClose')
    }
    this.emitter.emit('closed')
  }

  async _waitContinue () {
    await new Promise(resolve => {
      this.emitter.once('play', () => {
        this.isPlaying = true
        this.emitter.emit('played')
        resolve()
      })
    })
  }
}

export default Executor
