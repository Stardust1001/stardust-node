import os from 'os'
import child_process from 'child_process'

export const isWindows = () => {
  return /^win/i.test(os.platform())
}

export const openUrl = url => {
  child_process.spawn(isWindows() ? 'explorer' : 'open', [url])
}

export default {
  isWindows,
  openUrl
}
