import path from 'node:path'
import { chromium, firefox, webkit } from 'playwright'
import { funcs, highdict, eventemitter } from '@stardust-js/js'
import Storage from '../storage.js'
import Executor from './executor.js'
import { onError } from './utils.js'

export class Driver {
  constructor (config = {}) {
    config.headless = config.headless ?? false
    this.Executor = config.Executor ?? Executor
    this.config = config
    this.browser = null
    this.headlessBrowser = null
    this.context = null
    this.headlessContext = null
    this.executors = []
    this.log = config.log || console.log
    this.emitter = new eventemitter.EventEmitter()

    this.userCache = new Storage({
      filepath: path.join(config.userCacheFile),
      autoLoad: false,
      autoSave: false
    })
    this.indicators = {
      num_browsers: 0,
      num_contexts: 0,
      num_bots: 0,
      num_runs: 0
    }
    this.init()
  }

  async init () {
    try {
      await this.beforeInit?.()
    } catch (err) {
      onError(err, this.log, 'driver beforeInit')
    }
    await this.userCache.load()
    this.userCache.cache.num_runs = Object.values(this.userCache.cache.runs || {}).reduce((sum, org) => {
      return sum + Object.values(org).reduce((num, e) => num + e, 0)
    }, 0)
    this.indicators.num_runs = this.userCache.cache.num_runs
    try {
      await this.afterInit?.()
    } catch (err) {
      onError(err, this.log, 'driver afterInit')
    }
  }

  getBot (executor, code, props = {}) {
    throw '需要自行实现'
  }

  initBotCode (executor, meta, props, botCode) {
    const { _initialBot, _currentBot } = executor
    const { headless, newBrowser, newContext, product = 'chromium' } = executor.config
    botCode = 'const META = \n' + JSON.stringify({
      headless,
      newBrowser,
      newContext,
      product,
      props,
      initial: {
        org: _initialBot.org,
        name: _initialBot.name
      },
      from: {
        org: _currentBot.org,
        name: _currentBot.name
      }
    }, null, 2) + '\n' + botCode
    const cache = this.userCache.cache
    meta.params.forEach(p => {
      let value = props[p.prop] || highdict.get(cache, p.prop)
      if (value && typeof value === 'object') value = JSON.stringify(value)
      botCode = botCode.replaceAll('#' + p.prop + '#', value)
    })
    meta.props.forEach(p => {
      let value = props[p.prop]
      if (value && typeof value === 'object') value = JSON.stringify(value)
      botCode = botCode.replaceAll('#' + p.prop + '#', value)
    })
    return botCode + '\nreturn operations\n'
  }

  async exec (operations, options) {
    try {
      await this.beforeExec?.(operations, options)
    } catch (err) {
      onError(err, this.log, 'beforeExec')
    }
    if (!operations.length) return
    const defaultOptions = {
      newBrowser: false,
      newContext: false,
      log: this.log,
      Executor: this.Executor,
      emitter: this.emitter,
      ...this.config
    }
    for (let key in defaultOptions) {
      if (options[key] === undefined) {
        options[key] = defaultOptions[key]
      }
    }
    if (options.newBrowser) options.newContext = true
    const [browser, context] = await this.getContext(options)
    const executor = new this.Executor(this, browser, context, options)
    try {
      await this.afterCreateExecutor?.(executor)
    } catch (err) {
      onError(err, this.log, 'afterCreateExecutor')
    }
    this.executors.push(executor)

    this.indicators.num_bots ++
    executor.isExcuting = true
    await executor.execute(operations, 'exec')
    executor.isExcuting = false
    options.emitter.emit('done')
    this.indicators.num_bots --

    await this.clearExecutor(executor, options)
    this.updateRuns(options)
    try {
      await this.afterExec?.(operations, options)
    } catch (err) {
      onError(err, this.log, 'afterExec')
    }
    this.userCache.save()
  }

  updateRuns (options) {
    const { org, name } = options
    this.indicators.num_runs ++
    const { cache } = this.userCache
    cache.num_runs = this.indicators.num_runs
    cache.runs = cache.runs || {}
    const key = org + '.' + name
    const count = highdict.get(cache.runs, key, 0) + 1
    highdict.set(cache.runs, key, count)
  }

  getProduct (config) {
    const products = {
      'chromium': chromium,
      'firefox': firefox,
      'webkit': webkit
    }
    return products[config.product || 'chromium']
  }

  async getContext (options) {
    const product = this.getProduct(options)
    let browser = options.headless ? this.headlessBrowser : this.browser
    if (!browser || options.newBrowser) {
      browser = await product.launch(options)
      this.initBrowser(browser, options)
      this.indicators.num_browsers ++
    }
    let context = options.headless ? this.headlessContext : this.context
    if (!context || options.newContext) {
      context = await browser.newContext(options.contextOptions)
      this.initContext(context, options)
      this.indicators.num_contexts ++
    }
    if (!options.newBrowser) {
      if (options.headless) {
        this.headlessBrowser = browser
      } else {
        this.browser = browser
      }
    }
    if (!options.newContext) {
      if (options.headless) {
        this.headlessContext = context
      } else {
        this.context = context
      }
    }
    return [browser, context]
  }

  async initBrowser (browser, options) {
    browser.reconnect = () => {

    }

    browser.on('disconnected', () => {
      browser.reconnect()
    })
  }

  async initContext (context, options) {
    context.on('page', async page => {
      page.on('dialog', async dialog => {
        const { accept, dismiss, value } = page._dialog_ || {}
        if (accept) {
          if (value != null) {
            dialog.accept(value)
          } else {
            dialog.accept()
          }
        } else if (dismiss) {
          dialog.dismiss()
        } else {
          await funcs.sleep(this.config.dialogDismissDelay)
          dialog.dismiss().catch(Function())
        }
        page._dialog_ = null
      })
    })
    const scripts = options.initScripts || []
    await Promise.all(scripts.map(s => {
      let [filepath, content, arg] = [s]
      if (typeof s === 'object') {
        [filepath, content, arg] = [s.path, s.content, s.arg]
      }
      filepath = path.join(path.dirname(process.argv[1]), filepath)
      return context.addInitScript({ path: filepath, content }, arg)
    }))
  }

  async clearExecutor (executor, options) {
    if (options.newContext && !await executor.page.isClosed()) {
      await funcs.sleep(this.config.closeDelay)
    }
    if (options.newContext) {
      await executor.context.close()
      executor.context = null
      this.indicators.num_contexts --
    }
    if (options.newBrowser) {
      await executor.browser.close()
      executor.browser = null
      this.indicators.num_browsers --
    }
    this.executors = this.executors.filter(e => e !== executor)
  }

  async close () {
    try {
      await this.beforeClose?.()
    } catch (err) {
      onError(err, this.log, 'beforeClose')
    }
    const ps = []
    if (this.context) {
      ps.push(this.context.close())
      this.indicators.num_contexts --
      this.context = null
    }
    if (this.browser) {
      ps.push(this.browser.close())
      this.indicators.num_browsers --
      this.browser = null
    }
    if (this.headlessContext) {
      ps.push(this.headlessContext.close())
      this.indicators.num_contexts --
      this.headlessContext = null
    }
    if (this.headlessBrowser) {
      ps.push(this.headlessBrowser.close())
      this.indicators.num_browsers --
      this.headlessBrowser = null
    }
    await Promise.all(ps).catch(Function())
    try {
      await this.afterClose?.()
    } catch (err) {
      onError(err, this.log, 'afterClose')
    }
  }
}

export default Driver
