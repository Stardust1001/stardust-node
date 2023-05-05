import fs from 'fs'
import fsExtra from 'fs-extra'
import path from 'path'

export const exists = filepath => {
  return new Promise(resolve => fs.exists(filepath, resolve))
}

export const mkdir = async dirpath => {
  if (!await exists(dirpath)) {
    const parts = dirpath.split(path.sep)
    for (let i = 1; i <= parts.length; i++) {
      const branch = parts.slice(0, i).join(path.sep)
      if (!branch) continue
      if (!await exists(branch)) {
        await fs.promises.mkdir(branch)
      }
    }
  }
}

export const listDir = async dirpath => {
  if (!await exists(dirpath)) {
    return []
  }
  return fs.promises.readdir(dirpath)
}

export const listAll = async (dirpath) => {
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
  return fs.promises.stat(filepath)
}

export const isFile = async filepath => {
  return (await stat(filepath))?.isFile()
}

export const isDir = async filepath => {
  return (await stat(filepath))?.isDirectory()
}

export const write = (filepath, data, encoding = 'utf-8') => {
  return fs.promises.writeFile(filepath, data, encoding)
}

export const read = async (filepath, encoding = 'utf-8') => {
  if (!await exists(filepath)) return null
  return fs.promises.readFile(filepath, encoding)
}

export const rename = (source, desti) => {
  return fs.promises.rename(source, desti)
}

export const copy = (source, desti) => {
  return fsExtra.copy(source, desti)
}

export const remove = (filepath, options) => {
  options = {
    force: true,
    recursive: true,
    ...options
  }
  return fs.promises.rm(filepath, options)
}

export default {
  exists,
  mkdir,
  write,
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
