import { read, write } from './fsUtils.js'

class Storage {
  constructor (config = {}) {
    this.config = config
    const { filepath, autoLoad = false, jsonSpace = 2 } = config
    this.filepath = filepath
    this.jsonSpace = jsonSpace

    this.loaded = false
    this.storage = null

    if (autoLoad) this.load()
  }

  async load () {
    const text = await read(this.filepath)
    this.storage = JSON.parse(text || '{}')
    return this.storage
  }

  async save (storage = {}) {
    this.storage = storage
    await write(this.filepath, JSON.stringify(storage, null, this.jsonSpace))
  }

  getItem (key) {
    if (!this.loaded) throw new Error('please load first')
    return this.storage[key]
  }

  setItem (key, value) {
    if (!this.loaded) throw new Error('please load first')
    this.storage[key] = value
    this.save(this.storage)
  }

  clear () {
    if (!this.loaded) throw new Error('please load first')
    this.storage = {}
    this.save(this.storage)
  }
}

export default Storage
