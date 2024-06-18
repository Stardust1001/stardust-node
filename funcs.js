import os from 'node:os'
import path from 'node:path'
import child_process from 'node:child_process'

export const curfile = (importMeta) => {
  const filepath = importMeta?.url || import.meta.url.split('node_modules')[0]
  return filepath.slice(isWindows() ? 8 : 7)
}

export const curdir = (importMeta) => {
  return importMeta ? path.dirname(curfile(importMeta)) : curfile()
}

export const isWindows = () => {
  return /^win/i.test(os.platform())
}

export const openUrl = url => {
  child_process.spawn(isWindows() ? 'explorer' : 'open', [url])
}

export const pipeRes = (res, ctx, options) => {
  options = {
    compress: false,
    ...options
  }
  if (options.compress) {
    res.headers.delete('content-encoding')
  }
  res.headers.delete('content-length')
  ctx.res.writeHead(res.status, res.headers)
  res.body.pipe(ctx.res)
  return new Promise((resolve) => {
    res.body.on('end', resolve)
  })
}

export const importFile = filepath => {
  filepath = (filepath[0] === '/' ? 'file://' : 'file:///') + filepath
  return import(filepath)
}

export default {
  curfile,
  curdir,
  isWindows,
  openUrl,
  pipeRes,
  importFile
}
