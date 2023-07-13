import { checkAcl } from '../middlewares/index.js'
import { calcModel, makeBatchCtx } from '../utils.js'
import hooks from '../hooks.js'

export class RestfulRoute {
  constructor (app, router) {
    this.app = app
    this.router = router
    this.restful = app.service.restful
  }

  routes () {
    const router = this.router
    router.get('/restful', this.get.bind(this))
    router.post('/restful/add', this.add.bind(this))
    router.post('/restful/search', this.search.bind(this))
    router.put('/restful', this.update.bind(this))
    router.delete('/restful', this.remove.bind(this))
    router.post('/restful/func', this.func.bind(this))
    router.post('/restful/batch', this.batch.bind(this))
  }

  async get (ctx) {
    const { id, where, attributes, model, table, options } = ctx.request.meta
    await hooks.beforeGet(ctx.request.meta, ctx)
    await this.app.config.hooks.beforeGet?.(ctx.request.meta, ctx)
    ctx.body = {
      data: await this.restful.get(model, {
        where: where || { [table.primaryKeyField]: id },
        attributes
      }, options),
      err: null
    }
  }

  async add (ctx) {
    const { model, form, options } = ctx.request.meta
    await hooks.beforeAdd(ctx.request.meta, ctx)
    await this.app.config.hooks.beforeAdd?.(ctx.request.meta, ctx)
    ctx.body = {
      data: await this.restful.add(model, form, options),
      err: null
    }
  }

  async search (ctx) {
    const { model, form, options } = ctx.request.meta
    await hooks.beforeSearch(ctx.request.meta, ctx)
    await this.app.config.hooks.beforeSearch?.(ctx.request.meta, ctx)
    const result = await this.restful.search(model, form, options)
    result.data = result.data || null
    result.err = result.err || null
    ctx.body = result
  }

  async update (ctx) {
    const { id, where, model, form, table, options } = ctx.request.meta
    await hooks.beforeUpdate(ctx.request.meta, ctx)
    await this.app.config.hooks.beforeUpdate?.(ctx.request.meta, ctx)
    ctx.body = {
      data: await this.restful.update(model, where || { [table.primaryKeyField]: id }, form, options),
      err: null
    }
  }

  async remove (ctx) {
    const { id, where, model, table, options } = ctx.request.meta
    await hooks.beforeRemove(ctx.request.meta, ctx)
    await this.app.config.hooks.beforeRemove?.(ctx.request.meta, ctx)
    ctx.body = {
      data: await this.restful.remove(model, where || { [table.primaryKeyField]: id }, options),
      err: null
    }
  }

  async func (ctx) {
    const { model, form, options } = ctx.request.meta
    await hooks.beforeFunc(ctx.request.meta, ctx)
    await this.app.config.hooks.beforeFunc?.(ctx.request.meta, ctx)
    if (!Array.isArray(form) || form.length === 0) {
      ctx.body = { data: null, err: '参数错误' }
      return
    }
    const [funcName, ...props] = form
    ctx.body = {
      data: await this.restful.func(model, funcName, ...props, options),
      err: null
    }
  }

  async batch (ctx) {
    const funcs = ['get', 'add', 'search', 'update', 'remove', 'func']
    const routeFuncs = {}
    funcs.forEach(k => routeFuncs[k] = this[k])

    const { transaction = false, operations } = ctx.request.body || {}
    if (!Array.isArray(operations)) {
      ctx.body = { data: null, err: 'operations 无效' }
      return
    }
    const dbnames = [...new Set(operations.map(ele => ele.model.split('.')[0]))]
    if (transaction && dbnames.length > 1) {
      ctx.body = { data: '批请求事务不能操作多个数据库' }
      return
    }
    const source = this.app.db.sources[dbnames[0]]
    if (!source) {
      ctx.body = { data: 'model 无效' }
      return
    }

    const t = transaction ? await source.sequelize.transaction() : null

    const reses = []
    const promises = []
    for (let i = 0, len = operations.length; i < len; i++) {
      const operation = operations[i]
      if (!routeFuncs[operation.type]) {
        reses.push({ data: null, err: 'type 无效' })
      } else {
        const mockCtx = makeBatchCtx(operation, ctx)
        promises.push(new Promise(async (resolve, reject) => {
          let ok = false
          await checkAcl(mockCtx, () => ok = true)
          if (ok) {
            const routeFunc = routeFuncs[operation.type].bind(this)
            mockCtx.request.meta.options = {
              ...(mockCtx.request.meta.options || {}),
              transaction: t
            }
            await routeFunc(mockCtx).catch(reject)
          }
          reses[i] = mockCtx.body
          resolve()
        }))
      }
    }
    if (t) {
      try {
        await Promise.all(promises)
        await t.commit()
      } catch (e) {
        await t.rollback()
        throw e
      }
    } else {
      await Promise.all(promises)
    }
    ctx.body = { data: reses, err: null }
  }
}

export default RestfulRoute
