export async function completion({ url, token, messages, tools, signal }) {
  const response = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Phase0-Session': token },
    body: JSON.stringify({ messages, tools }),
  });
  if (!response.ok) throw Error(`Relay HTTP ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', text = '', doneMarker = false, total = 0;
  const calls = [];
  const parseEvent = event => {
    const data = event.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { doneMarker = true; return; }
    let chunk;
    try { chunk=JSON.parse(data); } catch(error) { throw new SyntaxError('Invalid SSE JSON: '+error.message); }
    if (chunk.error) throw Error('Upstream stream error');
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    text += delta.content ?? '';
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 10) throw Error('Invalid tool index');
      const call = calls[part.index] ??= { id: '', name: '', args: '' };
      call.id += part.id ?? '';
      call.name += part.function?.name ?? '';
      call.args += part.function?.arguments ?? '';
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2000000) throw Error('Stream limit exceeded');
      buffer += value;
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        parseEvent(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (doneMarker) break;
    }
    if (buffer.trim() && !doneMarker) parseEvent(buffer);
    if (!doneMarker) throw Error('Truncated stream');
    for (const call of calls) {
      if (!call || !call.id || !call.name) throw Error('Incomplete tool call');
      try { JSON.parse(call.args); } catch(error) { const failure=new SyntaxError('Invalid arguments for '+call.name+': '+error.message);failure.invalidToolArguments=true;throw failure; }
    }
    return { text, calls };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const tool = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });
export const tools = [
  tool('write_todos', 'Record a short plan before working.', schema({ todos: { type: 'array', items: { type: 'string' } } })),
  tool('write_file', 'Write a UTF-8 workspace file.', schema({ path: { type: 'string' }, content: { type: 'string' } })),
  tool('read_file', 'Read a UTF-8 workspace file.', schema({ path: { type: 'string' } })),
];
export async function runAgent(config) {
  const files = new Map([['/input.txt', 'hello from browser workspace']]);
  let plan = [];
  const events = [];
  const messages = [
    { role: 'system', content: 'Use write_todos to plan, read_file to read /input.txt, then write_file to copy its exact contents to /result.txt. Use tools for all file access. Finally give a brief completion message.' },
    { role: 'user', content: 'Plan, read the input file, and copy it to /result.txt.' },
  ];
  for (let step = 0; step < 8; step++) {
    const response = await completion({ ...config, messages, tools });
    if (!response.calls.length) {
      return { ok: true, events, plan, text: response.text, files: Object.fromEntries(files) };
    }
    messages.push({ role: 'assistant', content: response.text || null, tool_calls: response.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
    for (const call of response.calls) {
      const args = JSON.parse(call.args);
      let result;
      if (call.name === 'write_todos' && Array.isArray(args.todos) && args.todos.length <= 20 && args.todos.every(t => typeof t === 'string' && t.length <= 1000)) {
        plan = args.todos; result = 'Plan recorded';
      } else if (['read_file', 'write_file'].includes(call.name) && typeof args.path === 'string' && /^\/[\w.-]+$/.test(args.path) && !['/.', '/..'].includes(args.path)) {
        if (call.name === 'read_file') result = files.get(args.path) ?? 'File not found';
        else if (typeof args.content === 'string' && args.content.length <= 10000) { files.set(args.path, args.content); result = 'File written'; }
        else throw Error('Invalid file content');
      } else throw Error('Invalid tool call');
      events.push({ tool: call.name, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  throw Error('Agent step limit exceeded');
}
