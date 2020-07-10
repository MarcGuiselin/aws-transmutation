// A simple wildcard syntax matcher:
//   a => matches 'a'
//   * => matches anything
//   *a => matches anything that ends with 'a'
//   a|b => matches 'a' or 'b'

const AsRegex = wildcard => `^(${wildcard.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, ".*")})$`;

const Matches = (wildcard, match) => new RegExp(AsRegex(wildcard)).test(match);

module.exports = {
    AsRegex,
    Matches
}