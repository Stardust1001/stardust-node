import path from 'path'
import Sequelize from 'sequelize'
import { importFile } from '../funcs.js'
import { curdir } from '../funcs.js'
import { listAll } from '../fsUtils.js'

export const makeModels = async (db) => {
  const dirname = curdir()
  let files = await listAll(path.join(dirname, 'models'))
  files = files.filter(f => f.includes('init-models.js'))
  const initers = await Promise.all(files.map(async file => {
    const res = await importFile(file)
    return {
      database: file.split(path.sep).slice(-2)[0],
      initFunc: res.default
    }
  }))

  const models = {}
  initers.forEach(initer => {
    const { database, initFunc } = initer
    const source = db.sources[database]
    if (!source) return
    const databaseModels = initFunc(source.sequelize)
    Object.values(databaseModels).forEach(model => {
      const name = model.tableName
      source.models[name] = model
      models[`${database}.${name}`] = model
      if (source.alias) {
        models[`${source.alias}.${name}`] = model
      }
      if (source.main) {
        models[name] = model
        model.idField = Object.values(model.rawAttributes).find(e => e.primaryKey).fieldName
      }
    })
  })
  return models
}

export const connect = (config, source) => {
  const { sequelizeOptions } = config
  const { main, database, username, password, options } = source
  let params = [database, username, password]
  if (options.dialect === 'sqlite') {
    params = []
  } else if (options.dialect === 'oracle') {
    params = [source.service, username, password]
  }
  const sequelize = new Sequelize(
    ...params,
    {
      ...sequelizeOptions,
      ...options,
    }
  )

  return sequelize
}

const registerModels = async (db, config) => {
  const { datasources } = config
  datasources.forEach(ele => {
    const { main, alias, database, label, fields } = ele
    const sequelize = connect(config, ele)
    const source = {
      main,
      sequelize,
      label,
      fields,
      models: {}
    }
    db.sources[database] = source
    if (alias) {
      source.alias = alias
      db.sources[alias] = db.sources[database]
    }
  })
  const models = await makeModels(db)
  Object.assign(db.models, models)
}

export const calcModel = (model, models) => {
  let database = ''
  let modelName = model
  if (model.indexOf('.') > 0) {
    const parts = model.split('.')
    database = parts[0]
    modelName = parts[1]
  } else {
    database = Object.keys(models).find(key => key.split('.')[1] === model).split('.')[0]
  }
  return { database, modelName }
}

export const makeBatchCtx = (operation, ctx) => {
  const { type, model, id, data = { where: {} } } = operation
  const models = ctx.app.db.models
  const { database, modelName } = calcModel(model, models)
  const mockCtx = {
    app: ctx.app,
    url: '',
    request: {
      method: ({
        get: 'GET',
        update: 'PUT',
        destroy: 'DELETE'
      })[type] || 'POST',
      body: data,
      decodedToken: ctx.request.decodedToken,
      meta: {
        database,
        model,
        modelName,
        id,
        table: models[model],
        form: data,
        options: {}
      }
    }
  }
  if (['get', 'update', 'destroy'].includes(type)) {
    mockCtx.url = '/this.service'
  } else {
    mockCtx.url = '/this.service/' + type
  }
  mockCtx.url += '?model=' + model
  if (id) {
    mockCtx.url += '&id=' + id
  }
  return mockCtx
}

export default {
  makeModels,
  connect,
  registerModels,
  calcModel,
  makeBatchCtx
}
