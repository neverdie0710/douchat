export function userDataDirectoryName(development: boolean): 'douchat-dev' | 'douchat' {
  return development ? 'douchat-dev' : 'douchat'
}
