import { translateOp, translateAttributes, translateInclude } from '../translate.js'

export class RestfulService {
  constructor (db, config) {
    this.db = db
    this.config = config
  }

  async get (model, opts, options) {
    return this.db.models[model].findOne(opts, options)
  }

  async add (model, form, options) {
    return this.db.models[model].create(form, options)
  }

  async search (model, form = {}, options) {
    const table = this.db.models[model]
    let { page = 1, limit = 10, attributes, include, ...others } = form
    if (page < 1) page = 1
    if (page > Number.MAX_SAFE_INTEGER) page = 1
    if (limit > this.config.pagerMaxLimit) {
      return { err: 'limit 超出系统设置' }
    }
    if (form.group) {
      const fields = Object.keys(table.tableAttributes)
      const groupAttrs = Array.isArray(form.group) ? form.group : [form.group]
      if (groupAttrs.some(attr => !fields.includes(attr))) {
        return { err: 'group 包含无效字段' }
      }
    }
    const _limit = limit < 0 ? this.config.pagerMaxLimit : limit
    translateOp(others)

    const withCount = form.count !== false

    const props = {
      ...others,
      limit: _limit,
      offset: (page - 1) * _limit
    }
    if (attributes) {
      props.attributes = translateAttributes(attributes, table)
    }
    if (include) {
      props.include = translateInclude(include, table)
      if (withCount) {
        props.distinct = true
      }
    }

    const result = await table[withCount ? 'findAndCountAll' : 'findAll'](props, options)
    if (withCount && props.group) {
      result.rows.forEach((row, index) => {
        row.dataValues.$count = result.count[index].count
      })
      result.count = result.count.length
    }

    return {
      page,
      limit,
      total: withCount ? result.count : null,
      data: withCount ? result.rows : result
    }
  }

  async update (model, where, form, options) {
    return this.db.models[model].update(form, { where }, options)
  }

  async destroy (model, where, options) {
    return this.db.models[model].destroy({ where }, options)
  }

  async func (model, funcName, ...props) {
    const table = this.db.models[model]
    const options = props.pop()
    props = translateOp(props).map(prop => {
      if (prop?.include) {
        prop.include = translateInclude(prop.include, table)
      }
      return prop
    })
    if (!table[funcName]) {
      return null
    }
    return table[funcName](...props, options)
  }
}

export default RestfulService
