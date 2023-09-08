import jwt from 'jsonwebtoken'

export default (config) => {
  const sign = (data, options = {}) => {
    const { secret, expiresIn } = config.jwt
    return jwt.sign(data, secret, {
      expiresIn,
      ...options
    })
  }

  const verify = async (token) => {
    const { secret } = config.jwt
    return new Promise(resolve => {
      jwt.verify(token, secret, (err, decoded) => {
        resolve([err, decoded])
      })
    })
  }

  const isInWhiteList = (ctx) => {
    const { whiteList } = config.jwt
    const url = ctx.url.split('?')[0]
    return whiteList.some(ele => {
      if (ele instanceof RegExp) {
        return ele.test(url)
      }
      return ele === url
    })
  }

  return {
    sign,
    verify,
    isInWhiteList
  }
}
