
export class Acl {

  constructor (perms, options = {}) {
    const {
      read = false,
      add = false,
      update = false,
      destroy = false
    } = perms || { }
    const {
      get = read,
      search = read,
      updateById = update,
      updateBySearch = update
    } = perms || {}

    this.perms = {
      get,
      search,
      read,
      add,
      updateById,
      updateBySearch,
      update,
      destroy
    }
    this.options = {
      idField: 'id',
      creatorField: 'creator_id',
      ...options
    }
  }

  get (...props) {
    return this.check(...props) || this.perms.get || this.readBySelf(...props)
  }

  search (...props) {
    return this.check(...props) || this.perms.search || this.readBySelf(...props)
  }

  read (...props) {
    if (props[2].command === 'get') {
      return this.get(...props)
    }
    return this.search(...props)
  }

  add (...props) {
    return (this.check(...props) || this.perms.add) && this.addBySelf(...props)
  }

  updateById (...props) {
    this.deleteIdAndCreatorId(...props)
    return this.check(...props) || this.perms.updateById || this.updateBySelf(...props)
  }

  updateBySearch (...props) {
    this.deleteIdAndCreatorId(...props)
    return this.check(...props) || this.perms.updateBySearch || this.updateBySelf(...props)
  }

  update (...props) {
    if (props[2].command === 'update') {
      return this.updateById(...props)
    }
    return this.updateBySearch(...props)
  }

  destroy (...props) {
    return this.check(...props) || this.perms.destroy || this.destroyBySelf(...props)
  }

  byWhere (...props) {
    const reqAcl = props[2].reqAcl

    switch (reqAcl) {
      case 'get':
      case 'search': {
        this.readByWhere(...props)
        break
      }
      case 'add': {
        this.addByWhere(...props)
        break
      }
      case 'update': {
        this.updateByWhere(...props)
        break
      }
      case 'destroy': {
        this.destroyByWhere(...props)
        break
      }
    }
    return true
  }

  bySelf (...props) {
    return props[0] && this.byWhere(...props, {
      [this.options.creatorField]: props[0].id
    })
  }

  readByWhere (...props) {
    // TODO: sub include ?

    const { command, funcName, meta, form } = props[2]
    const where = props[3]

    switch (true) {
      case command === 'get': {
        this.setWhere(meta, {
          ...where,
          [this.options.idField]: meta.id
        })
        break
      }
      case command === 'search': {
        this.setWhere(form, where)
        break
      }
      case !!funcName: {
        this.setFuncWhere(form, where)
        break
      }
    }
    return true
  }

  addByWhere (...props) {
    if (!props[0]) {
      return false
    }
    const { command, funcName, form } = props[2]
    const where = props[props.length - 1]

    if (command === 'add') {
      Object.assign(form, where)
    } else if (funcName === 'create') {
      Object.assign(form[1], where)
    } else if (funcName === 'bulkCreate') {
      form[1] = form[1] || []
      form[1].forEach(record => {
        Object.assign(record, where)
      })
    }
    return true
  }

  updateByWhere (...props) {
    const { command, funcName, meta, form } = props[2]
    const where = props[props.length - 1]

    this.deleteIdAndCreatorId(...props)

    if (command === 'update') {
      this.setWhere(meta, {
        ...where,
        [this.options.idField]: meta.id,
      })
    } else if (!!funcName) {
      if (form.length < 3) {
        form.push({})
      }
      Object.assign(form[2], where)
    }
    return true
  }

  destroyByWhere (...props) {
    const { command, funcName, meta, form } = props[2]
    const where = props[props.length - 1]

    if (command === 'destroy') {
      this.setWhere(meta, {
        ...where,
        [this.options.idField]: meta.id
      })
    } else if (funcName === 'destroy') {
      this.setFuncWhere(form, where)
    }
    return true
  }

  readBySelf (...props) {
    return props[0] && this.readByWhere(...props, {
      [this.options.creatorField]: props[0].id
    }) || false
  }

  addBySelf (...props) {
    return props[0] && this.addByWhere(...props, {
      [this.options.creatorField]: props[0].id
    }) || false
  }

  updateBySelf (...props) {
    return props[0] && this.updateByWhere(...props, {
      [this.options.creatorField]: props[0].id
    }) || false
  }

  destroyBySelf (...props) {
    return props[0] && this.destroyByWhere(...props, {
      [this.options.creatorField]: props[0].id
    }) || false
  }

  setWhere (obj, where) {
    obj.where = Object.assign(obj.where || {}, where)
  }

  setFuncWhere (form, where) {
    form[1] = form[1] || {}
    this.setWhere(form[1], where)
  }

  deleteIdAndCreatorId (...props) {
    const { command, funcName, form } = props[2]
    const { idField, creatorField } = this.options
    if (command === 'update') {
      delete form[idField]
      delete form[creatorField]
    } else if (!!funcName) {
      delete form[1][idField]
      delete form[1][creatorField]
    }
  }

  filterFields (reqAcl, ...props) {
    if (reqAcl === 'update') {
      this.filterWriteFields(reqAcl, ...props)
    } else if (['get', 'search'].includes(reqAcl)) {
      this.filterReadFields(reqAcl, ...props)
    }
  }

  filterReadFields (reqAcl, ...props) {
    const readFields = Object.entries(this.config.fields).filter(field => {
      return field[1].read && field[1].read !== '*'
    })
    if (readFields.length === 0) {
      return
    }
    const readAttrs = readFields.map(field => field[0])
    const { command, funcName, meta } = props[2]
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
    const userRoles = props[0].roleNames
    const allowedAttrs = readFields.filter(field => {
      return field[1].read.some(role => userRoles.includes(role))
    }).map(field => field[0])
    if (Array.isArray(attributes)) {
      for (let i = attributes.length - 1; i >= 0; i--) {
        if (readAttrs.includes(attributes[i]) && !allowedAttrs.includes(attributes[i])) {
          attributes.splice(i, 1)
        }
      }
    } else {
      const readAttrs = readFields.map(field => field[0])
      const disallowAttrs = readAttrs.filter(attr => !allowedAttrs.includes(attr))
      attributes.exclude = (attributes.exclude || []).concat(disallowAttrs)
    }
    meta.attributes = attributes
  }

  filterWriteFields (reqAcl, ...props) {
    const writeFields = Object.entries(this.config.fields).filter(field => {
      return field[1].write && field[1].write !== '*'
    })
    if (writeFields.length === 0) {
      return
    }
    const { command } = props[2]
    const form = command === 'update' ? props[2].form : props[2].form[1]
    const userRoles = props[0].roleNames
    writeFields.forEach(field => {
      if (!field[1].write.some(role => userRoles.includes(role))) {
        delete form[field[0]]
      }
    })
  }
}

export class ModelAcl extends Acl {
  constructor (config, options = {}) {
    super(null, options)
    this.config = config
  }

  get (...props) {
    return this.check('get', ...props)
  }

  search (...props) {
    return this.check('search', ...props)
  }

  add (...props) {
    return this.check('add', ...props) && this.addBySelf(...props)
  }

  updateById (...props) {
    return this.check('updateById', ...props)
  }

  updateBySearch (...props) {
    return this.check('updateBySearch', ...props)
  }

  destroy (...props) {
    return this.check('destroy', ...props)
  }

  check (key, ...props) {
    const items = this.config[key]
    if (!Array.isArray(items)) {
      return false
    }
    const dt = props[0]
    const userRolenames = dt.roles.map(role => role.name)
    props[2].form.where = props[2].form.where || {}

    for (let item of items) {
      if (Array.isArray(item)) {
        if (this.isMatchRole(item[0], userRolenames)) {
          if (item[1](...props)) {
            return true
          }
        }
        continue
      }
      let [roleNames, by] = item.split('::')
      if (roleNames.indexOf(',') > 0) {
        roleNames = roleNames.split(',')
      }
      if (!this.isMatchRole(roleNames, userRolenames)) {
        continue
      }
      if (!by) {
        return true
      }
      if (by === 'self') {
        this.bySelf(...props)
      } else {
        const fields = by.split(',')
        const where = {}
        const form = props[2].form
        fields.forEach(field => {
          const [key, dKey] = field.split('->')
          const value = dt[dKey || key] || form.where[key]
          if (value != undefined) {
            where[key] = value
          }
        })
        if (Object.keys(where).length === 0) {
          return false
        }
        form.where = { ...form.where, ...where }
        this.byWhere(...props, where)
      }
      return true
    }
    return false
  }

  isMatchRole (roleNames, userRolenames) {
    if (roleNames === '*') {
      return true
    }
    if (Array.isArray(roleNames)) {
      return roleNames.some(name => userRolenames.includes(name))
    }
    return userRolenames.includes(roleNames)
  }
}

export const generateDbAcls = (config, app) => {
  const acl = { }
  for (let database in config.modelConfigs) {
    acl[database] = {}
    for (let table in config.modelConfigs[database]) {
      const model = app.db.models[database + '.' + table]
      if (!model) {
        continue
      }
      const tableConfig = config.modelConfigs[database][table]
      acl[database][table] = new ModelAcl(
        tableConfig.acl,
        {
          database,
          table,
          ...(tableConfig.fields || {}),
          idField: model.primaryKeyField
        }
      )
    }
  }
  return acl
}

export const defaultModelAcl = new ModelAcl({
  get: ['*'],
  search: ['*'],
  add: [],
  updateById: [],
  updateBySearch: [],
  destroy: []
}, {})

export default {
  Acl,
  ModelAcl,
  generateDbAcls,
  defaultModelAcl
}
