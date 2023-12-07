import { dates } from '@stardust-js/js'

const numberRegexp = /(INTEGER|BIGINT|FLOAT|REAL|DOUBLE|DECIMAL)/

const fieldsAlias = {
  creatorField: 'creator_id',
  updaterField: 'updater_id',
  createdAtField: 'created_at',
  updatedAtField: 'updated_at'
}

const deleteAliasFields = (meta, ctx) => {
  const idField = meta.table.primaryKeyField
  const { database, modelName, form } = meta
  const fields = { ...fieldsAlias }
  delete form[idField]
  delete form[fields.creatorField]
  delete form[fields.updaterField]
  delete form[fields.createdAtField]
  delete form[fields.updatedAtField]
  return fields
}

const deleteInvalidAttr = (meta, ctx) => {
  for (let key in meta.form) {
    const field = meta.table.rawAttributes[key]
    if (!field || typeof meta.form[key] === 'string' && numberRegexp.test(field.type.toString())) {
      delete meta.form[key]
    }
  }
}

export const beforeGet = (meta, ctx) => {

}

export const beforeAdd = (meta, ctx) => {
  deleteInvalidAttr(meta, ctx)
  const { form } = meta
  const fields = deleteAliasFields(meta, ctx)
  if (!form[fields.creatorField] && ctx.request.decodedToken.id) {
    form[fields.creatorField] = ctx.request.decodedToken.id
  }
  form[fields.createdAtField] = form[fields.updatedAtField] = dates.now().to()
}

export const beforeSearch = (meta, ctx) => {

}

export const beforeUpdate = (meta, ctx) => {
  deleteInvalidAttr(meta, ctx)
  const { form } = meta
  const fields = deleteAliasFields(meta, ctx)
  if (!form[fields.updaterField] && ctx.request.decodedToken.id) {
    form[fields.updaterField] = ctx.request.decodedToken.id
  }
  form[fields.updatedAtField] = dates.now().to()
}

export const beforeRemove = (meta, ctx) => {

}

export const beforeFunc = (meta, ctx) => {

}

export default {
  beforeGet,
  beforeAdd,
  beforeSearch,
  beforeUpdate,
  beforeRemove,
  beforeFunc
}
