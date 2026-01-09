/**
 * Test Script: Measure response time for math query
 * Simulates the user's query: "i have 28 apples and i eat 4 then i buy other 2 apples how many apple do i have right now?"
 */

const WebSocket = require('ws');

const TEST_QUERY = "i have 28 apples and i eat 4 then i buy other 2 apples how many apple do i have right now?";

console.log('🧪 Testing Math Optimization Performance\n');
console.log(`Query: "${TEST_QUERY}"\n`);

const ws = new WebSocket('ws://localhost:4000/chat');

let startTime;
let firstPhaseTime;
let firstTokenTime;
let completeTime;
let phaseCount = 0;
let tokenCount = 0;

ws.on('open', () => {
  console.log('✅ Connected to WebSocket\n');
  startTime = Date.now();
  
  const payload = {
    prompt: TEST_QUERY,
    task: 'chat',
    autoWeb: false,
    language: 'English'
  };
  
  console.log('📤 Sending query...\n');
  ws.send(JSON.stringify(payload));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    const elapsed = Date.now() - startTime;
    
    // Log reasoning phases
    if (message.type === 'reasoning_phase') {
      phaseCount++;
      if (!firstPhaseTime) {
        firstPhaseTime = elapsed;
        console.log(`⏱️  First phase appeared in: ${firstPhaseTime}ms`);
      }
      console.log(`  🧠 Phase ${phaseCount}: ${message.data.emoji} ${message.data.action} [+${elapsed - (firstPhaseTime || 0)}ms]`);
    }
    
    // Log tokens
    if (message.type === 'token') {
      tokenCount++;
      if (!firstTokenTime) {
        firstTokenTime = elapsed;
        console.log(`\n⏱️  First token appeared in: ${firstTokenTime}ms`);
      }
      process.stdout.write(message.data);
    }
    
    // Log completion
    if (message.type === 'done') {
      completeTime = elapsed;
      console.log('\n\n✅ Response Complete!\n');
      console.log('📊 Performance Metrics:');
      console.log(`   Total Time: ${completeTime}ms`);
      console.log(`   First Phase: ${firstPhaseTime}ms`);
      console.log(`   First Token: ${firstTokenTime}ms`);
      console.log(`   Thinking Time: ${firstTokenTime - firstPhaseTime}ms`);
      console.log(`   Generation Time: ${completeTime - firstTokenTime}ms`);
      console.log(`   Phases: ${phaseCount} (expected: 2 for SIMPLE)`);
      console.log(`   Tokens: ${tokenCount}`);
      console.log(`\n🎯 Result: ${completeTime < 2000 ? 'FAST ✅' : 'SLOW ⚠️'}`);
      
      ws.close();
      process.exit(0);
    }
    
    // Log errors
    if (message.type === 'error') {
      console.error(`\n❌ Error: ${message.error}`);
      ws.close();
      process.exit(1);
    }
  } catch (e) {
    // Ignore parse errors for partial messages
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket Error:', err.message);
  console.error('\nMake sure the server is running: npm start');
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n📌 WebSocket closed');
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n⏰ TIMEOUT: No response after 30 seconds');
  console.error('Server might be hung or not responding');
  ws.close();
  process.exit(1);
}, 30000);
