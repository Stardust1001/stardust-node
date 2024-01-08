import { funcs } from '@stardust-js/js'
import { read, write } from './fsUtils.js'

class Storage {
  constructor (config = {}) {
    this.config = config
    const { filepath, autoLoad = false, autoSave = true, jsonSpace = 2 } = config
    this.filepath = filepath
    this.autoLoad = autoLoad
    this.autoSave = autoSave
    this.jsonSpace = jsonSpace

    this.loaded = false
    this.cache = null

    if (autoLoad) this.load()
  }

  async load () {
    const text = await read(this.filepath)
    this.cache = JSON.parse(text || '{}')
    this.loaded = true
    return this.cache
  }

  async save (cache) {
    if (!this.loaded) throw new Error('please load first')
    this.cache = cache || this.cache
    if (this._isSaving) {
      return funcs.sleep(1000).then(() => this.save(this.cache))
    }
    this._isSaving = true
    await write(this.filepath, JSON.stringify(this.cache, null, this.jsonSpace))
    this._isSaving = false
  }

  getItem (key) {
    if (!this.loaded) throw new Error('please load first')
    return this.cache[key]
  }

  setItem (key, value) {
    if (!this.loaded) throw new Error('please load first')
    this.cache[key] = value
    this.save(this.cache)
  }

  clear () {
    if (!this.loaded) throw new Error('please load first')
    this.cache = {}
    this.save(this.cache)
  }
}

export default Storage
