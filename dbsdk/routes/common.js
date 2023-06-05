import { QueryTypes } from 'sequelize'

export class CommonRoute {
  constructor (app, router) {
    this.app = app
    this.router = router
    this.common = app.service.common
  }

  routes () {
    const router = this.router
    router.post('/common/upload_file', this.uploadFile.bind(this))
    router.get('/common/get_setting', this.getSetting.bind(this))
    router.post('/common/update_setting', this.updateSetting.bind(this))
    router.post('/common/call_sql', this.callSql.bind(this))
  }

  async uploadFile (ctx, next) {
    const { suffixes } = this.app.config.upload

    const files = ctx.request.files.file
    let names = []
    let err = null

    const checkValid = file => suffixes.some(suffix => file.originalFilename.toLowerCase().endsWith('.' + suffix))

    if (Array.isArray(files)) {
      if (files.some(file => !checkValid(file))) {
        err = '不支持上传的文件类型'
      } else {
        names = await Promise.all(files.map(f => this.common.saveFile(f)))
      }
    } else {
      if (!checkValid(files)) {
        err = '不支持上传的文件类型'
      } else {
        names = await this.common.saveFile(files)
      }
    }
    ctx.body = {
      data: '',
      filename: names,
      err
    }
  }

  async getSetting (ctx, next) {
    const { name } = ctx.query
    const settings = await this.common.getSettings()
    ctx.body = { data: settings[name] ?? null, err: null }
  }

  async updateSetting (ctx, next) {
    const settings = await this.common.getSettings()
    const { name, data } = ctx.request.body
    settings[name] = data
    await this.common.updateSettings(settings)
    ctx.body = { data: true, err: null }
  }

  async callSql (ctx, next) {
    const { name, params } = ctx.request.body
    const item = this.app.sqls[name]
    const error = !item && '未知的SQL语句' || item.params.some(key => {
      return !((key?.name ?? key) in params)
    }) && '参数不匹配'
    if (error) {
      ctx.body = { data: null, err: error }
      return
    }
    const sequelize = this.app.db.sources[item.db].sequelize
    let sql = item.sql
    item.params.forEach(p => {
      if (p?.raw) sql = sql.replace(':' + p.name, params[p.name])
    })
    const result = await sequelize.query(sql, {
      replacements: params,
      type: QueryTypes[item.queryType || 'SELECT']
    })
    ctx.body = { data: result, err: null }
  }
}

export default CommonRoute
