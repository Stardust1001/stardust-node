import fs from 'node:fs'
import path from 'node:path'
import fsExtra from 'fs-extra'

export const exists = filepath => {
  return new Promise(resolve => fs.exists(filepath, resolve))
}

export const mkdir = async (dirpath, options) => {
  if (!await exists(dirpath)) {
    return new Promise(resolve => {
      fs.mkdir(dirpath, { recursive: true, ...options }, resolve)
    })
  }
}

export const listDir = async dirpath => {
  if (!await exists(dirpath)) {
    return []
  }
  return new Promise(resolve => {
    fs.readdir(dirpath, (err, files) => resolve(err ? [] : files))
  })
}

export const listAll = async dirpath => {
  if (!await exists(dirpath)) {
    return []
  }
  const list = async (all, dirpath) => {
    if (await isDir(dirpath)) {
      const subs = await listDir(dirpath)
      await Promise.all(subs.map(s => list(all, path.join(dirpath, s))))
    } else {
      all.push(dirpath)
    }
  }
  const all = []
  await list(all, dirpath)
  return all
}

export const stat = filepath => {
  return new Promise(resolve => {
    fs.stat(filepath, (err, data) => resolve(err ? null : data))
  })
}

export const isFile = async filepath => {
  return (await stat(filepath))?.isFile()
}

export const isDir = async filepath => {
  return (await stat(filepath))?.isDirectory()
}

export const write = (filepath, data, options = 'utf-8') => {
  return new Promise(resolve => fs.writeFile(filepath, data, options, resolve))
}

export const append = (filepath, data, options = 'utf-8') => {
  return new Promise(resolve => fs.appendFile(filepath, data, options, resolve))
}

export const read = async (filepath, options = 'utf-8') => {
  if (!await exists(filepath)) return null
  return new Promise(resolve => {
    fs.readFile(filepath, options, (err, data) => resolve(err ? null : data))
  })
}

export const rename = (source, desti) => {
  return new Promise((resolve, reject) => fs.rename(source, desti, resolve))
}

export const copy = (source, desti) => {
  return new Promise((resolve, reject) => fsExtra.copy(source, desti, resolve))
}

export const remove = (filepath, options) => {
  return new Promise(resolve => {
    fs.rm(filepath, { force: true, recursive: true, ...options }, resolve)
  })
}

export default {
  exists,
  mkdir,
  write,
  append,
  read,
  rename,
  copy,
  remove,
  listDir,
  listAll,
  stat,
  isFile,
  isDir
}
