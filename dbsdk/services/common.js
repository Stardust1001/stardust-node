import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import fsUtils from '../../fsUtils.js'

export class CommonService {
  constructor (db, config) {
    this.db = db
    this.config = config

    this.uploadDir = ''
    this.settingsPath = ''
  }

  async init () {
    this.uploadDir = path.join(path.dirname(import.meta.url), this.config.uploadDir)
    this.settingsPath = path.join(path.dirname(import.meta.url), this.config.settingsPath)

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
}

export default CommonService
