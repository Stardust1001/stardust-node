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
  ctx.res.writeHead(res.status, headers)
  res.body.pipe(ctx.res)
  return new Promise((resolve) => {
    res.body.on('end', resolve)
  })
}

export default {
  isWindows,
  openUrl,
  pipeRes
}
