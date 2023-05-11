import { Op } from 'sequelize'

const opKeys = Object.keys(Op)
const opReg = /\[Op\./

export const translateOp = (params, root = true) => {
  if (root) {
    const text = JSON.stringify(params)
    if (!opReg.test(text)) {
      return params
    }
  }
  if (typeof params !== 'object' || params == null) {
    return params
  }
  if (Array.isArray(params)) {
    return params.map(ele => translateOp(ele, false))
  }
  Object.keys(params).forEach(key => {
    const value = translateOp(params[key], false)
    if (opReg.test(key)) {
      const opKey = key.slice(4, -1)
      if (!opKeys.includes(opKey)) {
        throw `参数无效 : ${key}`
      }
      delete params[key]
      params[Op[opKey]] = value
    } else {
      params[key] = value
    }
  })
  return params
}

export const translateAttributes = (attributes, table) => {
  if (Array.isArray(attributes)) {
    _translateAttrs(attributes, table)
  } else if (attributes.include) {
    _translateAttrs(attributes.include, table)
  }
  return attributes
}

export const translateInclude = (items, table) => {
  return items.map(item => {
    const { as, include, ...options } = item
    const foreignTable = table.associations[as]
    if (!foreignTable) {
      return null
    }
    const ele = {
      ...options,
      model: foreignTable.target,
      as: foreignTable.as
    }
    if (Array.isArray(include)) {
      ele.include = translateInclude(include, foreignTable.target)
    }
    return ele
  }).filter(item => item !== null)
}

const _translateAttrs = (attrs, table) => {
  const { fn, col } = table.sequelize
  attrs.forEach((attr, index) => {
    if (typeof attr === 'object') {
      attrs[index] = [fn(attr.fn, col(attr.col)), attr.as]
    }
  })
}

export default {
  translateOp,
  translateAttributes,
  translateInclude
}
