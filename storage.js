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
    return this.cache
  }

  async save (cache) {
    this.cache = cache || this.cache
    await write(this.filepath, JSON.stringify(cache, null, this.jsonSpace))
  }

  getItem (key) {
    if (!this.loaded) throw new Error('please load first')
    return this.cache[key]
  }

  setItem (key, value) {
    if (!this.loaded) throw new Error('please load first')
    this.cache[key] = value
    this.autoSave && this.save(this.cache)
  }

  clear () {
    if (!this.loaded) throw new Error('please load first')
    this.cache = {}
    this.autoSave && this.save(this.cache)
  }
}

export default Storage
