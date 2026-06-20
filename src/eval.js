const rows = [
  ['Right-wing cross', 'What just happened?', 'pass', 'baseline missed ball location'],
  ['Counterattack', 'Who has space?', 'pass', 'baseline omitted open left winger'],
  ['Possible foul', 'Why did crowd react?', 'pass', 'baseline lacked penalty-area context'],
  ['Right-wing cross', 'Brief mode', 'pass', 'improved concise enough for live audio']
];
document.getElementById('traceRows').innerHTML = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
