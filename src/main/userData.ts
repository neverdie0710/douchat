export function applicationName(development: boolean): 'Douchat Dev' | 'Douchat' {
  return development ? 'Douchat Dev' : 'Douchat'
}

export function userDataDirectoryName(development: boolean): 'douchat-dev' | 'douchat' {
  return development ? 'douchat-dev' : 'douchat'
}
