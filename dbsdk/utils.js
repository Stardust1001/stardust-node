import path from 'path'
import chalk from 'chalk'
import { glob } from 'glob'
import Sequelize from 'sequelize'

export const makeModels = async (db) => {
  const files = await glob('./models/*/init-models.js')
  const initers = await Promise.all(files.map(async file => {
    const name = path.join(process.cwd(), file)
    const res = await import(name)
    return {
      database: name.split('/').slice(-2)[0],
      initFunc: res.default
    }
  }))

  const models = {}
  initers.forEach(initer => {
    const { database, initFunc } = initer
    const source = db.sources[database]
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
    const { main, alias, database } = ele
    const sequelize = connect(config, ele)
    const source = {
      main,
      sequelize,
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
        remove: 'DELETE'
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
  if (['get', 'update', 'remove'].includes(type)) {
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

export const checkModelAcls = (app) => {
  const { sources } = app.db
  const { modelConfigs } = app.config
  const databases = Object.keys(sources)
  for (let database of databases) {
    if (!modelConfigs[database]) {
      console.log(chalk.red(`数据库 ${database} 未配置权限，此数据库将默认只读`))
    } else {
      const tables = Object.keys(sources[database].models)
      for (let table of tables) {
        if (!modelConfigs[database][table] || !modelConfigs[database][table].acl) {
          console.log(chalk.red(`数据表 ${database}.${table} 未配置权限，此数据表将默认只读`))
        }
      }
    }
  }
}

export default {
  makeModels,
  connect,
  registerModels,
  calcModel,
  makeBatchCtx,
  checkModelAcls
}
