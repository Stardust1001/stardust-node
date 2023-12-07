import jwt from '../jwt.js'

export const authToken = async (ctx, next) => {
  const { config } = ctx.app
  const { sign, verify, isInWhiteList } = jwt(config)

  const token = ctx.headers.authorization
  const [err, decoded] = token ? await verify(token) : ['', '']

  if ((config.jwt.auth !== false) && !isInWhiteList(ctx) && (!token || err)) {
    ctx.body = {
      code: 10001,
      data: null,
      err: '认证失败'
    }
    return
  }

  ctx.request.decodedToken = decoded || {
    id: null,
    username: 'anonymous',
    roles: [
      {
        id: null,
        name: 'anonymous'
      }
    ]
  }
  if (decoded) {
    ctx.request.acl = ctx.app.cache.getKey('user-' + decoded.id)
  }
  const { roles, iat, exp, id, username } = ctx.request.decodedToken
  ctx.request.decodedToken.roleNames = roles.map(role => role.name)
  await next()
  const refreshAt = iat + (exp - iat) * config.jwt.refreshAt
  if (Date.now() >= refreshAt * 1000) {
    ctx.set('Refresh-Token', sign({ id, username, roles }))
    let exposedHeaders = ctx.response.headers['access-control-expose-headers'] || ''
    if (exposedHeaders) {
      exposedHeaders += ', '
    }
    exposedHeaders += 'Refresh-Token'
    ctx.set('Access-Control-Expose-Headers', exposedHeaders)
  }
}

export default authToken
