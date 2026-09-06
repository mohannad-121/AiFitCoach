// Browser-only fixtures: never changes app authentication or writes remote data.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.TEMP.replaceAll('\\', '/')}/fitcoach-playwright/node_modules/playwright-core`);
const browser = await chromium.launch({ executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true });
const reports = [];
try {
for (const scenario of [
  { width:1440, height:1000, language:'en', gender:'male', theme:'dark' },
  { width:390, height:844, language:'ar', gender:'female', theme:'dark' },
  { width:768, height:1000, language:'en', gender:'female', theme:'light' },
]) {
  const page = await browser.newPage({ viewport:{ width:scenario.width,height:scenario.height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/hooks/useAuth.tsx*', route => route.fulfill({ contentType:'application/javascript',body:`const user={id:'qa-local',email:'qa@example.invalid'};export function useAuth(){return {user,session:null,loading:false,signOut:async()=>{}}}` }));
  await page.route('**/src/integrations/supabase/client.ts*', route => route.fulfill({contentType:'application/javascript',body:`const chain = new Proxy(function(){},{get:(_,key)=>key==='then'?(ok=>Promise.resolve({data:[],error:null}).then(ok)):key==='single'?()=>Promise.resolve({data:null,error:null}):()=>chain}); export const supabase={from:()=>chain,auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:null}})},channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:()=>{}};` }));
  await page.route('**/coach/pins/**', route => route.fulfill({json:{pins:[]}}));
  await page.route('**/adherence/workout', route => route.fulfill({status:503,json:{detail:'Unavailable in isolated QA'}}));
  await page.addInitScript(s => {
    localStorage.setItem('fitcoach_language',s.language);
    localStorage.setItem('fitcoach_theme',s.theme);
    localStorage.setItem('fitcoach_profile_qa-local',JSON.stringify({name:'QA',age:25,gender:s.gender,location:'home',goal:'fitness',fitnessLevel:'beginner',onboardingCompleted:true}));
    localStorage.setItem('fitcoach_schedule_plans_qa-local',JSON.stringify([{id:'qa-plan',title:'QA Training',title_ar:'تمارين الاختبار',is_active:true,created_at:new Date().toISOString(),plan_data:['Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday'].map(day=>({day,dayAr:day,exercises:[{exerciseId:'squats',name:'Squats',nameAr:'سكوات',sets:'3',reps:'12'},{exerciseId:'plank',name:'Plank',nameAr:'بلانك',sets:'3',reps:'30 sec'}]}))}]));
  },scenario);
  const assert = (test,message) => { if(!test) throw Error(message); };
  const snapshot = async name => {
    await page.waitForTimeout(500);
    const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
    assert(size.scroll<=size.view,`${name} overflow ${JSON.stringify(size)}`);
    await page.screenshot({path:`deliverables/training-${scenario.width}-${scenario.theme}-${name}.png`,fullPage:true});
  };
  await page.goto('http://127.0.0.1:8080/schedule');
  await page.locator('.day-muscle-map .anatomy-body').waitFor({timeout:12000}).catch(async error=>{console.log({url:page.url(),errors,body:(await page.locator('body').innerText()).slice(0,3000)});throw error;});
  assert(await page.locator('.day-muscle-map .anatomy-body').getAttribute('data-gender')===scenario.gender,'Profile anatomy mismatch');
  assert(await page.locator('.day-muscle-tags .is-pending').count()===2,'Expected quads + abs pending');
  await snapshot('schedule');
  await page.locator('.schedule-task-row [role=checkbox]').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.day-muscle-tags .is-pending').length===1);
  assert(await page.locator('.day-muscle-tags .is-done').count()===1,'Completed muscle not dimmed');
  await page.locator('.schedule-task-row [role=checkbox]').first().click();
  await page.locator('.day-muscle-map a').click();
  await page.locator('.workouts-exercise-list article').first().waitFor();
  assert(await page.locator('.workouts-exercise-list article').count()===2,'Day handoff must show exactly 2');
  await snapshot('workouts');
  await page.locator('.workouts-exercise-list article').first().getByRole('button').last().click();
  await page.locator('.live-exercise-picker').waitFor();
  await page.locator('.live-exercise-picker > summary').click();
  assert(new URL(page.url()).searchParams.has('exerciseId'),'Missing camera handoff');
  const active = await page.locator('.live-exercise-picker button[aria-pressed=true]').textContent();
  assert(active?.includes(scenario.language==='ar'?'السكوات':'Squats'),'Camera did not retain requested squat');
  await page.locator('#exercise').fill('curl');
  await page.locator('#exercise').fill('');
  assert(await page.locator('.live-exercise-picker button[aria-pressed=true]').textContent()===active,'Search replaced active movement');
  await page.locator('.live-exercise-picker > summary').click();
  await snapshot('camera');
  if(scenario.width===1440) {
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('QA denied','NotAllowedError');};});
    await page.getByRole('button',{name:'Start camera',exact:true}).click();
    await page.waitForTimeout(300);
    assert(await page.getByRole('button',{name:'Stop Session',exact:true}).count()===0,'Permission denial started a session');
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const stream=canvas.captureStream(12);globalThis.__qaTimer=setInterval(()=>canvas.getContext('2d').fillRect(0,0,640,480),80);globalThis.__qaTrack=stream.getVideoTracks()[0];globalThis.__qaCanvas=canvas;return stream;};});
    await page.getByRole('button',{name:'Start camera',exact:true}).click();
    await page.getByRole('button',{name:'Stop Session',exact:true}).waitFor({timeout:45000}).catch(async error=>{console.log({errors,body:(await page.locator('body').innerText()).slice(-4000),track:await page.evaluate(()=>globalThis.__qaTrack?.readyState)});throw error;});
    await page.getByRole('button',{name:'Stop Session',exact:true}).click();
    assert(await page.evaluate(()=>globalThis.__qaTrack.readyState)==='ended','Camera track not released');
    await page.evaluate(()=>clearInterval(globalThis.__qaTimer));
  }
  await page.goto('http://127.0.0.1:8080/workouts?muscles=biceps');
  await page.locator('.training-references summary').click();
  await page.locator('.training-references video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.training-references video')?.readyState>=1);
  assert(await page.locator('.training-references video').evaluate(v=>v.duration>0),'Reference video invalid');
  await snapshot('references');
  reports.push({...scenario,errors,status:'passed'});
  await page.close();
}
} finally { await browser.close(); console.log(JSON.stringify(reports,null,2)); }
