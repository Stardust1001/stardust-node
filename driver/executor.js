import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Papa from 'papaparse'
import Excel from 'exceljs'
import randomUa from 'random-useragent'
import { funcs, highdict, dates, promises } from '@stardust-js/js'
import nodeFuncs from '../funcs.js'
import fsUtils from '../fsUtils.js'
import Storage from '../storage.js'
import Loader from './loader.js'
import Dumper from './dumper.js'
import { parseSelectors, chainLocator, onError } from './utils.js'

export class Executor {
  constructor (driver, browser, context, config = {}) {
    this.driver = driver
    this.browser = browser
    this.context = context
    this.config = config
    this.executors = []
    this.page = config.page
    this.topPage = config.topPage
    this.cache = null
    this.log = config.log || console.log

    this.libs = {
      fs,
      path,
      crypto,
      Papa,
      Excel,
      randomUa
    }
    this.utils = {
      funcs,
      highdict,
      dates,
      fsUtils,
      nodeFuncs,
      ...nodeFuncs,
      ...funcs,
      ...highdict,
      ...dates,
      ...fsUtils,
      Loader,
      Dumper
    }

    this.isExcuting = false
    this._state = {}
    this._ifs = []
    this._initialBot = this.config
    this._currentBot = this.config
    this._waitFailed = false
    this.init()
  }

  async init () {
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
      const ele = operations[i]
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

  async new () {
    const page = await this.context.newPage()
    const executor = new this.config.Executor(this.driver, this.browser, this.context, {
      ...this.config,
      page,
      topPage: this.topPage
    })
    this.executors.push(executor)
    return executor
  }

  async goto (url, options) {
    const hasUrl = !!url
    url ||= this.config.homeUrl + '/blank/index.html'
    if (!this.page) {
      this.page = await this.context.newPage()
      try {
        await this.afterNewPage?.(this.page, url, options)
      } catch (err) {
        onError(err, this, 'afterNewPage')
      }
    }
    this.topPage = this.topPage || this.page
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
    options = {
      ignoreError: true,
      state: 'visible',
      timeout: 1e9,
      ...options
    }
    const loc = this.locator(selector, options)
    await loc.waitFor(options).then(() => {
      this._waitFailed = false
    }).catch(err => {
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
    const ps = [
      this.page.waitForLoadState(state || 'domcontentloaded', options).then(() => {
        this._waitFailed = false
      }).catch(err => {
        this._waitFailed = true
        if (!options.ignoreError) onError(err, this, 'waitForLoadState')
      })
    ]
    if (Array.isArray(operations)) {
      ps.push(this.execute(operations, 'waitForLoadState', options))
    }
    return Promise.all(ps)
  }

  async waitForNext (title = '下一步', options) {
    options = { ...options }
    await this.eval(`
      const mask = document.createElement('div')
      mask.style.cssText += \`
        position: fixed;
        z-index: 999998;
        width: 100vw;
        height: 100vh;
        left: 0;
        top: 0;
        background-color: rgba(0, 0, 0, 0.3);
        pointer-events: none;
        ${options.maskStyle}
      \`
      document.body.appendChild(mask)
      const button = document.createElement('div')
      const root = '${options.root || ''}'
      document.querySelector(root || 'body').appendChild(button)
      button.style.cssText += \`
        z-index: 999999;
        width: 300px;
        height: 30px;
        line-height: 30px;
        text-align: center;
        background-color: #ff0040;
        color: white;
        font-size: 15px;
        cursor: pointer;
        margin: 2px;
      \`
      if (!root) {
        button.style.cssText += \`
          position: fixed;
          right: 5px;
          bottom: 5px;
        \`
      }
      button.style.cssText += \`
        ${options.style}
      \`
      button.onmouseover = () => {
        button.style.opacity = 0.8
      }
      button.onmouseout = () => {
        button.style.opacity = 1
      }
      button.textContent = \`${title}\`
      new Promise(resolve => {
        button.onclick = () => {
          button.remove()
          mask.remove()
          resolve()
        }
      })
    `)
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
    return (await this.waitFor(selector, options)).blur(options)
  }

  async box (selector, options = {}) {
    return (await this.waitFor(selector, options)).boundingBox(options)
  }

  async checkFor (selector, options = {}) {
    return (await this.waitFor(selector, options)).check(options)
  }

  async uncheckFor (selector, options = {}) {
    return (await this.waitFor(selector, options)).uncheck(options)
  }

  async clear (selector, options = {}) {
    return (await this.waitFor(selector, options)).clear(options)
  }

  async click (selector, options = {}) {
    return (await this.waitFor(selector, options)).click(options)
  }

  async count (selector, options = {}) {
    return (await this.waitFor(selector, options)).count(options)
  }

  async dblclick (selector, options = {}) {
    return (await this.waitFor(selector, options)).dblclick(options)
  }

  async dragTo (selector, targetSelector, options = {}) {
    return (await this.waitFor(selector, options)).dragTo(this.locator(targetSelector), options)
  }

  eval (func, args = {}) {
    return (args.page || this.page).evaluate(func, args)
  }

  async evalOn (selector, func, options = {}) {
    if (typeof func === 'string') {
      func = eval('node => ' + func)
    }
    return (await this.waitFor(selector, options)).evaluate(func, options)
  }

  async evalOnAll (selector, func, options = {}) {
    return (await this.waitFor(selector, options)).evaluateAll(func, options)
  }

  async evaluateHandle (selector, func, args, options = {}) {
    return (await this.waitFor(selector, options)).evaluateHandle(func, args, options)
  }

  async set (selector, attr, value, bySetter = false) {
    if (typeof value === 'function') {
      value = await this.eval(value)
    }
    return this.eval(`
      const node = $one('${selector}')
      const value = eval(\`${value}\`)
      if (${bySetter}) {
        node.setAttribute('${attr}', value)
      } else {
        node['${attr}'] = value
      }
    `)
  }

  async fill (selector, value, options = {}) {
    return (await this.waitFor(selector, options)).fill(value, options)
  }

  async type (selector, value, options = {}) {
    return (await this.waitFor(selector, options)).type(value, options)
  }

  async focus (selector, options = {}) {
    return (await this.waitFor(selector, options)).focus(options)
  }

  async hover (selector, options = {}) {
    return (await this.waitFor(selector, options)).hover(options)
  }

  async press (selector, keys, options = {}) {
    options = {
      interval: 20,
      ...options
    }
    keys = Array.isArray(keys) ? keys : [keys]
    const loc = await this.waitFor(selector, options)
    for (let key of keys) {
      loc.press(key, options)
      await this.sleep(options.interval)
    }
  }

  async tap (selector, options = {}) {
    return (await this.waitFor(selector, options)).tap(options)
  }

  async select (selector, value, options = {}) {
    return (await this.waitFor(selector, options)).selectOption(value, options)
  }

  async check (selector, value, options = {}) {
    return (await this.waitFor(selector, options)).setChecked(value, options)
  }

  async upload (selector, value, options = {}) {
    return (await this.waitFor(selector, options)).setInputFiles(value, options)
  }

  async screenshot (selector, options = {}) {
    return (await this.waitFor(selector, options)).screenshot(options)
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
    this.page.close()
    this.page = page
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
    return (await this.waitFor(selector, options)).scrollIntoViewIfNeeded(options)
  }

  async attr (selector, name, options = {}) {
    return (await this.waitFor(selector, options)).getAttribute(name, options)
  }

  async call (selector, method, options = {}) {
    return (await this.waitFor(selector, options))[method](options)
  }

  async html (selector, options = {}) {
    return (await this.waitFor(selector, options)).innerHTML(options)
  }

  async text (selector, options = {}) {
    return (await this.waitFor(selector, options)).innerText(options)
  }

  async content (selector, options) {
    return (await this.waitFor(selector)).textContent(options)
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
    const executor = new this.config.Executor(this.driver, this.browser, this.context, {
      ...this.config,
      page: frame,
      topPage: this.topPage
    })
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
    const text = await this.eval(`window.prompt('${options.placeholder}')`, options)
    await this.fill(selector, text, options)
  }

  async fillOcr (selector, imgSelector, options) {
    const { ocrCaptchaUrl } = this.config
    if (ocrCaptchaUrl) {
      const base64 = await this.eval(`webot.funcs.img2Base64('${imgSelector}')`, options)
      const data = await fetch(ocrCaptchaUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: base64 })
      }).then(res => res.json())
      return this.fill(selector, data.text, options)
    }
    return this.prompt(selector, options)
  }

  async save (data, saveTo, key, options) {
    options = { comment: true, ...options }
    if (typeof data === 'function') {
      data = await data(this.safeThis)
    }
    if (typeof saveTo === 'object') {
      highdict.set(saveTo, key, data)
      return saveTo
    }
    const dirname = path.join(this.config.tempDir, crypto.randomUUID())
    await fsUtils.mkdir(dirname)
    const name = saveTo
    saveTo = path.join(dirname, path.basename(saveTo))
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
      const { each, saveTo } = optionsOrFunc
      const fields = optionsOrFunc.fields.map(ele => {
        if (typeof ele === 'object') {
          return ele
        }
        const [prop, selector, type] = ele.split('::')
        return { prop, selector, type }
      })
      list = await this.eval(`
        const fields = JSON.parse('${JSON.stringify(fields)}')
        $all('${each}').map(n => {
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
    options = {
      resetable: false,
      ...options
    }
    return this.eval(`
      document.title = '${title}'
      if (!${options.resetable}) {
        Object.defineProperty(document, 'title', {
          get: () => '${title}',
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
            shiki.setCDN('${this.config.homeUrl}/lib/shiki');
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

  async load (filepath, options, ...props) {
    if (typeof filepath === 'function') {
      filepath = await filepath(this.safeThis)
    }
    options = { ...options }
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
    options = {
      limit: 10,
      ...options
    }
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
      const iframe = document.createElement('iframe')
      iframe.id = 'blank-' + Date.now().toString(16)
      iframe.name = iframe.id
      iframe.style.cssText += \`
        position: fixed;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        display: block;
        border: 0;
        outline: 0;
        z-index: 999999;
        background-color: white;
        ...${options.iframeCss}
      \`
      iframe.src = '${this.config.homeUrl}/blank/index.html'
      document.body.appendChild(iframe)
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
    const result = await frame.evaluate(code)
    this.eval(`$one('#${name}').remove()`)
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
              options: JSON.parse('${JSON.stringify(options)}'),
              action: '${this.config.apiUrl}/upload',
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
      const fields = JSON.parse('${JSON.stringify(fields)}')
      const options = JSON.parse('${JSON.stringify(options)}')
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
  }
}

export default Executor
