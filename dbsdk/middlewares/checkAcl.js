import { defaultModelAcl } from '../acl.js'

const noop = {
  code: 10002,
  data: null,
  err: '鉴权失败'
}

const getCommand = (ctx) => {
  return ({
    GET: 'get',
    PUT: 'update',
    DELETE: 'remove'
  })[ctx.request.method]
  || ctx.url.split('?')[0].split('/')[2]
}

const allowFuncs = new Set([
  'count', 'max', 'min', 'sum',
  'findAll', 'findAndCountAll', 'findOne',
  'get', 'search',
  'create', 'bulkCreate',
  'update', 'increase', 'decrease',
  'destroy'
])

const getRequestAcl = (command, isFunc, funcName) => {
  if (isFunc && !allowFuncs.has(funcName)) {
    return ''
  }
  if (command === 'get') {
    return 'get'
  } else if (
    command === 'search' ||
    isFunc && ('count|max|min|sum'.includes(funcName) ||
    funcName.startsWith('find'))
  ) {
    return 'search'
  } else if (
    command === 'add' ||
    isFunc && 'create|bulkCreate'.includes(funcName)
  ) {
    return 'add'
  } else if (
    command === 'update' ||
    isFunc && 'update|increase|decrease'.includes(funcName)
  ) {
    return 'update'
  } else if (
    command === 'remove' ||
    isFunc && 'destroy'.includes(funcName)
  ) {
    return 'remove'
  }
}

export const checkAcl = async (ctx, next) => {
  if (!ctx.url.startsWith('/restful') || ctx.url.startsWith('/restful/batch')) {
    return next()
  }
  const { decodedToken, meta } = ctx.request
  const { database, model, modelName } = meta
  const acl = (ctx.app.config.modelAcls[database] || {})[modelName] || defaultModelAcl

  const command = getCommand(ctx)
  const isFunc = command === 'func'
  const funcName = isFunc && meta.form[0] || ''
  const reqAcl = getRequestAcl(command, isFunc, funcName)

  if (!reqAcl) {
    ctx.body = noop
    return
  }

  const props = [
    decodedToken,
    model,
    { reqAcl, command, funcName, meta, form: ctx.request.body }
  ]

  const beforeAcl = ctx.app.config.hooks.beforeAcl
  if (beforeAcl) {
    if (!await beforeAcl(ctx, ...props)) {
      return
    }
  }

  const hasPerm = acl[reqAcl](...props)

  if (!hasPerm) {
    ctx.body = noop
    return
  }

  if (acl.config.fields) {
    acl.filterFields(reqAcl, ...props)
    if (meta.attributes) {
      const isNoneAttributes = Array.isArray(meta.attributes) && meta.attributes.length === 0
      if (isNoneAttributes) {
        ctx.body = {
          ...noop,
          err: noop.err + '(空字段列表)'
        }
        return
      }
    }
  }

  return next()
}

export default checkAcl
