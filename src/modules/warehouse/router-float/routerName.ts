export function routerName(model: string) {
  return /\brouters?\b/i.test(model) ? model : model + ' Router'
}
