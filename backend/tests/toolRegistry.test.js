const test = require('node:test');
const assert = require('node:assert');
const { TOOL_DEFINITIONS, executeTool } = require('../src/voice/tools/toolRegistry');
const { ALLOWED_DISPOSITIONS } = require('../src/voice/tools/updateDisposition');

test('Tool Registry & Tool Execution Validation', async (t) => {
  await t.test('verifies all expected tools exist in tool definitions', () => {
    const toolNames = TOOL_DEFINITIONS.map((t) => t.name);
    const expected = [
      'mark_interested',
      'transfer_call',
      'save_notes',
      'update_disposition',
      'schedule_callback',
      'end_call'
    ];

    for (const name of expected) {
      assert(toolNames.includes(name), `Missing expected tool definition: ${name}`);
    }
  });

  await t.test('validates parameters in tool schemas', () => {
    const markInterested = TOOL_DEFINITIONS.find((t) => t.name === 'mark_interested');
    assert.strictEqual(markInterested.parameters.type, 'object');
    assert(markInterested.parameters.properties.debtAmount);
    assert(markInterested.parameters.required.includes('debtAmount'));

    const scheduleCallback = TOOL_DEFINITIONS.find((t) => t.name === 'schedule_callback');
    assert(scheduleCallback.parameters.properties.datetime);
    assert(scheduleCallback.parameters.required.includes('datetime'));
  });

  await t.test('handles unknown tool call gracefully', async () => {
    const mockSession = { callId: 'test_call_123' };
    const result = await executeTool('non_existent_tool', {}, mockSession);
    assert.strictEqual(result.success, false);
    assert(result.error.includes('Unknown tool name'));
  });

  await t.test('verifies standard allowed dispositions list', () => {
    assert(ALLOWED_DISPOSITIONS.includes('Qualified'));
    assert(ALLOWED_DISPOSITIONS.includes('Interested'));
    assert(ALLOWED_DISPOSITIONS.includes('Not Interested'));
    assert(ALLOWED_DISPOSITIONS.includes('Callback Requested'));
    assert(ALLOWED_DISPOSITIONS.includes('DNC'));
  });
});
