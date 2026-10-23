import assert from "node:assert/strict";
import { saveWorkmateScreenshot } from "./record-workmate-media.js";

export async function assertDesktopLayout(page:any) {
  const result=await page.evaluate(()=>{
    const root=document.getElementById("root")!;
    const horizontal=[root,...document.querySelectorAll(".table-scroll,.tabs,.local-agent-artifacts,.local-agent-messages,.local-agent-sessions,.local-agent-conversation,.modal")]
      .filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(el).visibility!=="hidden";})
      .filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({element:el.id||el.className,width:el.clientWidth,content:el.scrollWidth}));
    const rails=[root,...root.querySelectorAll("*")].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(el).visibility!=="hidden";}).filter(el=>{
      const css=getComputedStyle(el);
      return ((el.scrollHeight>el.clientHeight+1&&/(auto|scroll)/.test(css.overflowY))||(el.scrollWidth>el.clientWidth+1&&/(auto|scroll)/.test(css.overflowX)))
        && (css.scrollbarWidth!=="none"||getComputedStyle(el,"::-webkit-scrollbar").display!=="none");
    }).map(el=>el.id||el.className);
    const outside=[...root.querySelectorAll(".main-content button,.main-content input,.main-content textarea,.main-content select,.main-content table")]
      .filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(el).visibility!=="hidden";})
      .filter(el=>{const b=el.getBoundingClientRect();return b.left< -1||b.right>innerWidth+1;}).map(el=>el.getAttribute("aria-label")||el.tagName+":"+el.textContent?.slice(0,90));
    return {horizontal,rails,outside,width:innerWidth,height:innerHeight};
  });
  assert.deepEqual(result.horizontal,[],"Actual Desktop content must reflow rather than require horizontal scrolling: "+JSON.stringify(result));
  assert.deepEqual(result.rails,[],"Actual overflowing areas must not expose scrollbar rails");
  assert.deepEqual(result.outside,[],"Controls and table content must fit the actual window width");
  return result;
}

export async function checkDesktopWorkLayout(j:any) {
  const {page,resize,until}=j;
  for(const [width,height] of [[1440,980],[1280,800],[800,600]]){
    await resize(width,height,"real Desktop layout "+width+"x"+height);
    await assertDesktopLayout(page);
    const messages=page.getByRole("log",{name:"Local work history",exact:true});
    assert.equal(await messages.evaluate((el:HTMLElement)=>el.scrollHeight>el.clientHeight+10),true,"Use the actual long native conversation");
    await messages.focus();await messages.press("Home");
    await until(()=>messages.evaluate((el:HTMLElement)=>el.scrollTop),(top:number)=>top<2,"keyboard reaches first message");
    const box=await messages.boundingBox();assert.ok(box&&box.height>=64);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,300);
    await until(()=>messages.evaluate((el:HTMLElement)=>el.scrollTop),(top:number)=>top>10,"native wheel still scrolls with hidden rails");
    await messages.focus();await messages.press("End");
    await until(()=>messages.evaluate((el:HTMLElement)=>el.scrollTop+el.clientHeight>=el.scrollHeight-2),Boolean,"keyboard reaches final native message");
    const artifacts=page.getByRole("region",{name:"Project artifacts",exact:true});await artifacts.getByRole("button").last().focus();
    assert.equal(await artifacts.getByRole("button").last().evaluate((el:HTMLElement)=>{
      const b=el.getBoundingClientRect(),p=el.parentElement!.getBoundingClientRect();return b.left>=p.left&&b.right<=p.right+1&&b.top>=p.top&&b.bottom<=p.bottom+1;
    }),true,"The last actual download action remains reachable by focus");
    await page.getByLabel("Local task",{exact:true}).focus();
    j.screenshots.push(await saveWorkmateScreenshot("desktop","local-"+j.attempt,"layout-"+width+"-en",await page.screenshot(),"Actual frameless packaged Desktop: real long native history, wheel/Home/End, last artifact focus, wrapping content and no scrollbar rails; model text is an explicit fixture",j.delivery));
  }
  await resize(1440,980,"restore full native workspace after layout checks");
  j.pass("Actual 1440x980, 1280x800 and 800x600 Desktop has no visible scrollbar rails or horizontal overflow, while wheel/Home/End reaches the long history and focus reaches the last real download");
}

export async function checkDesktopAccountLayout(j:any) {
  const {page,resize}=j;
  const theme=page.getByTitle("Theme: light / dark / system",{exact:true});
  const setTheme=async(value:string)=>{
    for(let i=0;i<4&&await page.evaluate(()=>document.documentElement.dataset.theme)!==value;i++)await theme.click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),value);
  };
  await resize(800,600,"real compact Desktop settings and billing");
  for(const name of ["Usage & plan","Devices & files","Account settings"]){
    await page.locator(".sidebar-bottom").getByRole("link",{name,exact:true}).click();await page.getByRole("heading",{name,exact:true}).waitFor();
    await assertDesktopLayout(page);
    j.screenshots.push(await saveWorkmateScreenshot("desktop","local-"+j.attempt,"layout-"+name.split(" ")[0].toLowerCase()+"-en",await page.screenshot(),"Actual compact Desktop account page with current company identity and data; no horizontal layout or visible scrollbar rails",j.delivery));
  }
  await page.locator(".sidebar nav").getByRole("link",{name:"Local Agent",exact:true}).click();await page.getByLabel("Local specialist",{exact:true}).waitFor();
  const navigation=page.getByRole("navigation",{name:"Main navigation",exact:true});
  await navigation.focus();await navigation.press("End");await navigation.getByRole("link").last().focus();
  assert.equal(await navigation.getByRole("link").last().evaluate((el:HTMLElement)=>{
    const b=el.getBoundingClientRect(),p=el.parentElement!.getBoundingClientRect();return b.top>=p.top-1&&b.bottom<=p.bottom+1;
  }),true,"Last actual navigation destination remains reachable");
  for(const locale of ["en","zh"]){
    if(locale==="zh")await page.getByTitle("切換至繁體中文",{exact:true}).click();
    for(const value of ["light","dark"]){
      await setTheme(value);await assertDesktopLayout(page);
      j.screenshots.push(await saveWorkmateScreenshot("desktop","local-"+j.attempt,"layout-compact-"+locale+"-"+value,await page.screenshot(),"Actual compact Desktop language/theme controls and native history; no visible rails, no horizontal layout overflow, real company permissions retained",j.delivery));
    }
  }
  await page.getByTitle("Switch to English",{exact:true}).click();await setTheme("light");await resize(1440,980,"restore native workspace before final locale and sign-out checks");
  j.pass("Compact company billing, devices and account pages reflow; last navigation destination stays reachable; actual English/Traditional Chinese light/dark controls retain native history without scrollbar rails");
}
