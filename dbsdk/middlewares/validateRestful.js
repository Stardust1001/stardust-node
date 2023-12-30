import { translateInclude } from '../translate.js'
import { calcModel } from '../utils.js'

export const validateRestful = async (ctx, next) => {
  let err = ''
  if (ctx.url.startsWith('/restful') && !ctx.url.startsWith('/restful/batch')) {
    const models = ctx.app.db.models
    const method = ctx.request.method
    const { model, id } = ctx.query
    if (!model || !models[model]) {
      err = !model ? '缺少参数: model' : '参数 model 无效'
    } else if (['GET', 'PUT', 'DELETE'].includes(method) && (id == null || id === '')) {
      err = '缺少参数: id'
    } else {
      const { database, modelName } = calcModel(model, models)
      const table = models[model]
      const form = ctx.request.body
      const options = {}
      ctx.request.meta = {
        database,
        model,
        modelName,
        id,
        table,
        form,
        options
      }
      if (form.$options) {
        Object.assign(options, form.$options)
        delete form.$options
      }
      if (Array.isArray(options.include)) {
        options.include = translateInclude(options.include, table)
        if (options.include.length) {
          const related = {}
          options.include.forEach(ele => {
            if (form[ele.as]) {
              related[ele.as] = form[ele.as]
              delete form[ele.as]
            }
          })
          options.related = related
        }
      }
    }
  }
  if (err) {
    ctx.body = { data: null, err }
    return
  }
  return next()
}

export default validateRestful
