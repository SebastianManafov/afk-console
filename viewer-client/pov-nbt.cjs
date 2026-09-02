// Java POV rendering only needs block data, not NBT parsing. The full
// prismarine-nbt package compiles protodef functions dynamically, which is
// incompatible with the dashboard CSP. Keep the rare block-entity helpers
// harmless without pulling that parser into the worker bundle.
module.exports = {
  simplify: value => value,
  comp: value => ({ type: 'compound', value }),
  string: value => ({ type: 'string', value }),
  byte: value => ({ type: 'byte', value }),
  int: value => ({ type: 'int', value }),
  float: value => ({ type: 'float', value }),
  double: value => ({ type: 'double', value }),
  list: value => ({ type: 'list', value })
}
