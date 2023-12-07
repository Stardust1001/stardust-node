const noop = {
  code: 10002,
  data: null,
  err: '鉴权失败'
}

const getCommand = (ctx) => {
  return ({
    GET: 'get',
    PUT: 'update',
    DELETE: 'destroy'
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
    command === 'destroy' ||
    isFunc && 'destroy'.includes(funcName)
  ) {
    return 'destroy'
  }
}

export const checkAcl = async (ctx, next) => {
  if (!ctx.url.startsWith('/restful') || ctx.url.startsWith('/restful/batch')) {
    return next()
  }
  const { decodedToken, meta, acl } = ctx.request
  if (acl.roles.some(r => r.name === 'super')) {
    return next()
  }

  const { database, model, modelName } = meta

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
  if (beforeAcl && !await beforeAcl(ctx, ...props)) return

  const hasPerm = acl.roles.some(r => {
    return r.acl.some(e => {
      return e.table === model && e.acl.includes(reqAcl)
    })
  })

  if (!hasPerm) {
    ctx.body = noop
    return
  }

  const noLimitFields = acl.roles.some(role => {
    return role.acl.some(acl => {
      return acl.table === model && !acl.fields
    })
  })
  if (noLimitFields) {
    return next()
  }
  filterFields(ctx, acl, ...props)
  if (meta.attributes) {
    const isNoneAttributes = Array.isArray(meta.attributes) && meta.attributes.length === 0
    if (isNoneAttributes) {
      ctx.body = {
        ...noop,
        err: noop.err + '(无权查看任何字段)'
      }
      return
    }
  }

  return next()
}

const filterFields = (ctx, acl, ...props) => {
  let readFields = []
  let writeFields = []
  acl.roles.forEach(role => {
    role.acl.forEach(acl => {
      if (acl.table === props[1]) {
        readFields.push(...acl.fields.read)
        writeFields.push(...acl.fields.write)
      }
    })
  })
  readFields = [...new Set(readFields)]
  writeFields = [...new Set(writeFields)]
  const { reqAcl, form, command, funcName, meta } = props[2]
  if (reqAcl === 'update') {
    const form = command === 'update' ? form : form[1]
    for (let key in form) {
      if (!writeFields.includes(key)) {
        delete form[key]
      }
    }
  } else if (reqAcl === 'get' || reqAcl === 'search') {
    let attributes = null
    if (command === 'get') {
      attributes = meta.attributes || {}
      meta.attributes = attributes
    } else if (command === 'search') {
      attributes = meta.form.attributes || {}
      meta.form.attributes = attributes
    } else if (!!funcName) {
      attributes = meta.form[1].attributes || {}
      meta.form[1].attributes = attributes
    }
    if (Array.isArray(attributes)) {
      for (let i = attributes.length - 1; i >= 0; i--) {
        if (!readFields.includes(attributes[i])) {
          attributes.splice(i, 1)
        }
      }
    } else {
      const allFields = Object.keys(ctx.app.db.models[props[1]].rawAttributes)
      attributes.exclude = (attributes.exclude || []).concat(allFields.filter(f => !readFields.includes(f)))
    }
    meta.attributes = attributes
  }
}

export default checkAcl
