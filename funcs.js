import os from 'os'
import child_process from 'child_process'

export const isWindows = () => {
  return /^win/i.test(os.platform())
}

export const openUrl = url => {
  child_process.spawn(isWindows() ? 'explorer' : 'open', [url])
}

export const pipeRes = (res, ctx) => {
  const headers = {}
  Array.from(res.headers.entries()).forEach(([k, v]) => headers[k] = v)
  delete headers['content-encoding']
  delete headers['content-length']
  ctx.res.writeHead(res.status, headers)
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
  isWindows,
  openUrl,
  pipeRes,
  importFile
}
