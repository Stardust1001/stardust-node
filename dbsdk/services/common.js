import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import fsUtils from '../../fsUtils.js'
import { curdir } from '../../funcs.js'

export class CommonService {
  constructor (db, config) {
    this.db = db
    this.config = config

    this.uploadDir = ''
    this.settingsPath = ''
  }

  async init () {
    const dirname = curdir()
    this.uploadDir = path.join(dirname, this.config.uploadDir)
    this.settingsPath = path.join(dirname, this.config.settingsPath)

    if (!(await fsUtils.exists(this.uploadDir))) {
      await fsUtils.mkdir(this.uploadDir)
    }
  }

  async saveFile (file) {
    if (!this.uploadDir) {
      await this.init()
    }
    const filename = crypto.randomUUID() + '.' + file.originalFilename.split('.').pop()
    const desti = fs.createWriteStream(path.join(this.uploadDir, filename))
    fs.createReadStream(file.filepath).pipe(desti)
    return 'upload/' + filename
  }

  async getSettings () {
    if (!this.uploadDir) {
      await this.init()
    }
    const text = await fsUtils.read(this.settingsPath)
    try {
      return JSON.parse(text || '{}')
    } catch {
      return {}
    }
  }

  async updateSettings (settings) {
    await fsUtils.write(this.settingsPath, JSON.stringify(settings, null, 4))
  }

  async getSchemas () {
    const datasources = []
    for (let name in this.db.sources) {
      const source = this.db.sources[name]
      if (source.cluster && source.cluster !== source.database) continue
      const readonly = source.fields?.readonly
      const tables = []
      for (let key in source.models) {
        const fields = Object.entries(source.models[key].rawAttributes).filter(([prop, field]) => {
          return field.type.toString() !== 'VIRTUAL'
        }).map(([prop, field]) => {
          const item = { name: prop, label: field.comment }
          if (field.primaryKey) item.primaryKey = true
          if (field.primaryKey || field._autoGenerated || readonly?.includes(prop)) item.readonly = true
          return item
        })
        tables.push({ name: key, label: source.models[key].options.label, fields })
      }
      datasources.push({ name, tables, label: source.label })
    }
    return datasources
  }
}

export default CommonService
