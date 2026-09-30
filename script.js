(()=> {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  const num = id => parseFloat($(id).value) || 0;
  let fault = false;
  let lastChoice = null;

  const profileMap = {
    low:{fc:150,bw:100,v:28,duty:12},
    mid:{fc:300,bw:180,v:24,duty:10},
    high:{fc:430,bw:120,v:18,duty:8}
  };

  function applyProfile(){
    const p = $('#profile').value;
    if(p==='custom') return;
    const q = profileMap[p];
    $('#tfc').value=q.fc;
    $('#tbw').value=q.bw;
    $('#tvolt').value=q.v;
    $('#tduty').value=q.duty;
  }

  function bindReadouts(){
    const pairs = [
      ['#temp','#tempOut',v=>v+' °C'],
      ['#sal','#salOut',v=>v+' PSU'],
      ['#depth','#depthOut',v=>v+' m'],
      ['#ph','#phOut',v=>Number(v).toFixed(2)],
      ['#turb','#turbOut',v=>v+' NTU'],
      ['#sea','#seaOut',v=>v+' dB'],
      ['#range','#rangeOut',v=>v+' m'],
      ['#resolution','#resOut',v=>Number(v).toFixed(2)+' m'],
      ['#battery','#batteryOut',v=>v+' Wh'],
      ['#reserve','#reserveOut',v=>v+' Wh'],
      ['#pings','#pingsOut',v=>Math.round(v).toLocaleString()]
    ];
    pairs.forEach(([i,o,f])=>{
      const el=$(i), out=$(o);
      const u=()=>out.textContent=f(el.value);
      el.addEventListener('input',u);
      u();
    });
  }

  function soundSpeed(T,S,D){
    return 1448.96 + 4.591*T - 5.304e-2*T*T + 2.374e-4*T*T*T +
      1.340*(S-35) + 1.630e-2*D + 1.675e-7*D*D -
      1.025e-2*T*(S-35) - 7.139e-13*T*D*D*D;
  }

  function absorptionAM(f,T,S,Dm,pH){
    const D = Dm/1000;
    const f1 = 0.78*Math.sqrt(Math.max(S,1)/35)*Math.exp(T/26);
    const f2 = 42*Math.exp(T/17);
    const A = 0.106*Math.exp((pH-8)/0.56);
    const B = 0.52*(1+T/43)*(S/35)*Math.exp(-D/6);
    const C = 0.00049*Math.exp(-(T/27 + D/17));
    return A*f1*f*f/(f1*f1+f*f) + B*f2*f*f/(f2*f2+f*f) + C*f*f;
  }

  function transmissionLoss(r,alpha){
    return 20*Math.log10(Math.max(r,1)) + alpha*(r/1000);
  }

  function rangeMargin(cand,env){
    const TL = transmissionLoss(env.range,cand.alpha);
    const ampDb = 20*Math.log10(Math.max(cand.amp,0.01));
    const processingGain = 10*Math.log10(Math.max((cand.bw*1000)*(cand.dur/1000),1));
    const turbPenalty = 0.02*env.turb;
    const receivedIndex =
      env.sl + ampDb - 2*TL + env.ts - env.nl - env.sea - turbPenalty + env.di + processingGain;
    return receivedIndex - env.dt;
  }

  function energyPing(cand,hw){
    const Vrms = (cand.amp*hw.maxV)/Math.sqrt(2);
    const pLoad = (Vrms*Vrms)/Math.max(hw.z,1);
    const pElectrical = pLoad/Math.max(hw.eff,0.05);
    return pElectrical*(cand.dur/1000);
  }

  function makeCandidates(env,hw){
    const fcMin = Math.max(100, hw.tfc-hw.tbw/2);
    const fcMax = Math.min(500, hw.tfc+hw.tbw/2);
    const fcs=[100,150,200,250,300,350,400,450,500];
    const bws=[40,80,120,180];
    const durs=[0.25,0.5,1,2];
    const amps=[0.3,0.5,0.7,0.9];

    const reasons={transducer:0,dac:0,resolution:0,range:0,energy:0,duty:0};
    const all=[], feasible=[];
    const budgetWh=Math.max(0,env.battery-env.reserve)/Math.max(env.pings,1);
    const budgetJ=budgetWh*3600;

    for(const fc of fcs){
      for(const bw of bws){
        for(const dur of durs){
          for(const amp of amps){
            const low=fc-bw/2;
            const high=fc+bw/2;
            const cand={fc,bw,dur,amp};
            all.push(cand);

            if(low<fcMin || high>fcMax){ reasons.transducer++; continue; }

            const spc=(hw.fs*1000)/Math.max(high,1);
            if(spc<12){ reasons.dac++; continue; }

            const estimatedDuty = dur/100;
            if(estimatedDuty>hw.duty){ reasons.duty++; continue; }

            cand.alpha = absorptionAM(fc,env.T,env.S,env.D,env.pH);
            cand.res = env.c/(2*bw*1000);

            if(cand.res>env.reqRes){ reasons.resolution++; continue; }

            cand.margin = rangeMargin(cand,env);
            if(cand.margin<0){ reasons.range++; continue; }

            cand.energy = energyPing(cand,hw);
            if(cand.energy>budgetJ){ reasons.energy++; continue; }

            feasible.push(cand);
          }
        }
      }
    }

    if(!feasible.length) return {all,feasible,reasons,budgetJ};

    const maxEnergy=Math.max(...feasible.map(x=>x.energy),1e-9);
    const maxMargin=Math.max(...feasible.map(x=>x.margin),1);
    const minRes=Math.min(...feasible.map(x=>x.res),env.reqRes);
    const weights = {
      resolution:[0.2,0.6,0.2],
      balanced:[0.35,0.35,0.3],
      range:[0.6,0.2,0.2],
      eco:[0.2,0.15,0.65]
    }[env.mission];

    feasible.forEach(c=>{
      const rhat=clamp(c.margin/maxMargin,0,1);
      const qhat=clamp(minRes/Math.max(c.res,1e-6),0,1);
      const ehat=clamp(c.energy/maxEnergy,0,1);
      c.score=weights[0]*rhat + weights[1]*qhat - weights[2]*ehat;
    });

    feasible.sort((a,b)=>b.score-a.score);
    return {all,feasible,reasons,budgetJ};
  }

  function getState(){
    const env={
      T:num('#temp'),
      S:num('#sal'),
      D:num('#depth'),
      pH:num('#ph'),
      turb:num('#turb'),
      sea:num('#sea'),
      range:num('#range'),
      reqRes:num('#resolution'),
      battery:num('#battery'),
      reserve:num('#reserve'),
      pings:num('#pings'),
      mission:$('#mission').value,
      sl:num('#sl'),
      nl:num('#nl'),
      ts:num('#ts'),
      di:num('#di'),
      dt:num('#dt')
    };
    env.c=soundSpeed(env.T,env.S,env.D);

    const hw={
      tfc:num('#tfc'),
      tbw:num('#tbw'),
      maxV:num('#tvolt'),
      duty:num('#tduty'),
      fs:num('#dacrate'),
      bits:num('#dacbits'),
      eff:num('#eff')/100,
      z:num('#zload')
    };

    return {env,hw};
  }

  function chooseWaveform(c){
    const mode=$('#mission').value;
    return {
      ...c,
      wave: mode==='eco' ? 'Phase-Coded Pulse' : 'LFM Chirp',
      window: mode==='range' ? 'Hamming' : mode==='resolution' ? 'Blackman' : 'Hann'
    };
  }

  function run(){
    const {env,hw}=getState();
    const result=makeCandidates(env,hw);
    let choice=result.feasible[0] ? chooseWaveform(result.feasible[0]) : null;

    if($('#stability').checked && lastChoice && choice){
      const closeInBand=Math.abs(choice.fc-lastChoice.fc)<=50;
      if(closeInBand && lastChoice.margin>-3) choice={...lastChoice};
    }

    if(choice) lastChoice={...choice};
    render(env,hw,result,choice);
  }

  function render(env,hw,res,choice){
    $('#candAll').textContent=res.all.length.toLocaleString();
    $('#candOk').textContent=res.feasible.length.toLocaleString();
    $('#kC').textContent=env.c.toFixed(1)+' m/s';

    const alphaAt = choice ? choice.alpha : absorptionAM(hw.tfc,env.T,env.S,env.D,env.pH);
    $('#kAlpha').textContent=alphaAt.toFixed(2)+' dB/km';

    if(!choice){
      $('#txStatus').textContent='TX INHIBIT';
      $('#statusNote').textContent='No candidate meets all mission, energy and hardware constraints.';
      ['#kFc','#kBw','#kDur','#kAmp','#kWave','#kWindow','#kResolution','#kSpc','#kEnergy','#kMargin']
        .forEach(x=>$(x).textContent='—');
      $('#energyBar').style.width='0%';
      $('#energyUsed').textContent='—';
    }else{
      $('#txStatus').textContent='FEASIBLE';
      $('#statusNote').textContent='Selected after hard-constraint rejection and mission-weighted scoring.';
      $('#kFc').textContent=choice.fc+' kHz';
      $('#kBw').textContent=choice.bw+' kHz';
      $('#kDur').textContent=choice.dur.toFixed(2)+' ms';
      $('#kAmp').textContent=Math.round(choice.amp*100)+'%';
      $('#kWave').textContent=choice.wave;
      $('#kWindow').textContent=choice.window;
      $('#kResolution').textContent=(choice.res*100).toFixed(1)+' cm';
      $('#kSpc').textContent=((hw.fs*1000)/(choice.fc+choice.bw/2)).toFixed(1);
      $('#kEnergy').textContent=(choice.energy*1000).toFixed(2)+' mJ';
      $('#kMargin').textContent=(choice.margin>=0?'+':'')+choice.margin.toFixed(1)+' dB';

      const pct=clamp(choice.energy/Math.max(res.budgetJ,1e-9)*100,0,100);
      $('#energyBar').style.width=pct.toFixed(1)+'%';
      $('#energyUsed').textContent=pct.toFixed(1)+'% of '+(res.budgetJ*1000).toFixed(2)+' mJ';
    }

    renderRejects(res.reasons,res.all.length);
    renderDecision(env,hw,choice);
    renderWave(choice);
    renderFreq(choice,hw);
    renderResponse(choice,hw);
    renderPulse(choice);
    renderCandidates(res);
    renderHealth(choice,hw);
    renderGates(choice,hw,res);
  }

  function renderRejects(r,total){
    const items=[
      ['Outside transducer band',r.transducer],
      ['DAC sample quality',r.dac],
      ['Resolution shortfall',r.resolution],
      ['Range / link margin',r.range],
      ['Energy budget',r.energy],
      ['Duty-cycle limit',r.duty]
    ];

    $('#rejectList').innerHTML=items.map(([n,v])=>{
      const pct=Math.min(100,100*v/Math.max(total,1));
      return '<div class="reject-row"><div class="top"><span>'+n+'</span><span>'+v+'</span></div><div class="meter"><span style="width:'+pct+'%"></span></div></div>';
    }).join('');
  }

  function renderDecision(env,hw,c){
    if(!c){
      $('#decisionText').textContent='Transmission is inhibited. Relax the mission requirement, increase available energy, select a compatible transducer, or increase DAC/driver capability.';
      return;
    }

    const mode={
      resolution:'resolution-priority',
      balanced:'balanced range / resolution / energy',
      range:'range-priority',
      eco:'energy-priority'
    }[env.mission];

    $('#decisionText').textContent =
      'Selected '+c.fc+' kHz with '+c.bw+' kHz bandwidth for the '+mode+
      ' mission. It remains inside the '+(hw.tfc-hw.tbw/2).toFixed(0)+'–'+
      (hw.tfc+hw.tbw/2).toFixed(0)+' kHz transducer band, meets the requested '+
      (env.reqRes*100).toFixed(0)+' cm range resolution and '+env.range+
      ' m model range, and stays inside the per-ping energy budget.';
  }

  function prepCanvas(id){
    const c=$(id);
    const ctx=c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);
    const css=getComputedStyle(document.documentElement);
    return {
      c,ctx,
      text:css.getPropertyValue('--text').trim()||'#e7f0f8',
      muted:css.getPropertyValue('--muted').trim()||'#9db0c3',
      border:css.getPropertyValue('--border').trim()||'#27415a',
      s2:css.getPropertyValue('--accent').trim()||'#58c4dc',
      s3:css.getPropertyValue('--accent-2').trim()||'#8be0a5',
      s4:css.getPropertyValue('--warn').trim()||'#f6c85f'
    };
  }

  function axes(o,xlab,ylab){
    const {c,ctx,muted,border}=o;
    ctx.strokeStyle=border;
    ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(52,18);
    ctx.lineTo(52,c.height-40);
    ctx.lineTo(c.width-18,c.height-40);
    ctx.stroke();
    ctx.fillStyle=muted;
    ctx.font='12px sans-serif';
    ctx.fillText(xlab,c.width/2-25,c.height-12);
    ctx.save();
    ctx.translate(16,c.height/2+30);
    ctx.rotate(-Math.PI/2);
    ctx.fillText(ylab,0,0);
    ctx.restore();
  }

  function windowVal(name,t){
    if(name==='Blackman') return .42-.5*Math.cos(2*Math.PI*t)+.08*Math.cos(4*Math.PI*t);
    if(name==='Hamming') return .54-.46*Math.cos(2*Math.PI*t);
    return .5*(1-Math.cos(2*Math.PI*t));
  }

  function renderWave(ch){
    const o=prepCanvas('#waveCanvas');
    axes(o,'time →','amplitude');
    if(!ch) return;

    const {c,ctx,s2}=o;
    ctx.strokeStyle=s2;
    ctx.lineWidth=1.5;
    ctx.beginPath();

    let phase=0;
    const N=900;
    for(let i=0;i<N;i++){
      const t=i/(N-1);
      const f0=ch.fc-ch.bw/2;
      const f=f0+ch.bw*t;
      phase+=2*Math.PI*f/N/20;
      const y=Math.sin(phase)*windowVal(ch.window,t)*ch.amp;
      const x=52+t*(c.width-72);
      const py=(c.height-40)/2-y*(c.height-75)*.42;
      if(i===0) ctx.moveTo(x,py);
      else ctx.lineTo(x,py);
    }
    ctx.stroke();
  }

  function renderFreq(ch,hw){
    const o=prepCanvas('#freqCanvas');
    axes(o,'pulse time','frequency (kHz)');
    if(!ch) return;

    const {c,ctx,s3,muted}=o;
    const ymap=f=>18+(500-f)/400*(c.height-60);
    const lo=hw.tfc-hw.tbw/2;
    const hi=hw.tfc+hw.tbw/2;

    ctx.fillStyle='rgba(139,224,165,.10)';
    ctx.fillRect(52,ymap(hi),c.width-70,ymap(lo)-ymap(hi));

    ctx.strokeStyle=s3;
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(52,ymap(ch.fc-ch.bw/2));
    ctx.lineTo(c.width-18,ymap(ch.fc+ch.bw/2));
    ctx.stroke();

    ctx.fillStyle=muted;
    ctx.font='11px sans-serif';
    ctx.fillText('usable transducer band '+lo.toFixed(0)+'–'+hi.toFixed(0)+' kHz',62,ymap(hi)+15);
  }

  function responseAt(f,hw){
    const x=(f-hw.tfc)/(Math.max(hw.tbw,1)/2);
    return Math.exp(-1.4*x*x);
  }

  function renderResponse(ch,hw){
    const o=prepCanvas('#responseCanvas');
    axes(o,'frequency (kHz)','relative output');

    const {c,ctx,s2,s3}=o;
    ctx.strokeStyle=s3;
    ctx.lineWidth=2;
    ctx.beginPath();

    for(let i=0;i<400;i++){
      const f=100+i/399*400;
      const r=responseAt(f,hw);
      const x=52+i/399*(c.width-70);
      const y=c.height-40-r*(c.height-70);
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.stroke();

    if(ch){
      ctx.strokeStyle=s2;
      ctx.lineWidth=3;
      const lo=ch.fc-ch.bw/2, hi=ch.fc+ch.bw/2;
      const x1=52+(lo-100)/400*(c.width-70);
      const x2=52+(hi-100)/400*(c.width-70);
      const y=$('#preEQ').checked?46:76;
      ctx.beginPath();
      ctx.moveTo(x1,y);
      ctx.lineTo(x2,y);
      ctx.stroke();
    }
  }

  function renderPulse(ch){
    const o=prepCanvas('#pulseCanvas');
    axes(o,'delay','normalized correlation');
    if(!ch) return;

    const {c,ctx,s4}=o;
    const width=clamp(180/ch.bw,1,8);
    ctx.strokeStyle=s4;
    ctx.lineWidth=2;
    ctx.beginPath();

    for(let i=0;i<600;i++){
      const x0=(i-300)/40;
      const main=Math.exp(-(x0*x0)/(2*width*width));
      const side=.08*Math.sin(5*x0)/(1+Math.abs(x0));
      const yv=main+side;
      const x=52+i/599*(c.width-70);
      const y=c.height-40-yv*(c.height-72);
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  function renderCandidates(res){
    const o=prepCanvas('#candidateCanvas');
    axes(o,'energy per ping →','score ↑');
    if(!res.feasible.length) return;

    const {c,ctx,s2,muted}=o;
    const maxE=Math.max(...res.feasible.map(x=>x.energy),1e-6);
    const minS=Math.min(...res.feasible.map(x=>x.score));
    const maxS=Math.max(...res.feasible.map(x=>x.score));

    res.feasible.slice(0,220).forEach((x,i)=>{
      const px=52+(x.energy/maxE)*(c.width-74);
      const py=18+(1-(x.score-minS)/Math.max(maxS-minS,.001))*(c.height-60);
      ctx.fillStyle=i===0?s2:muted;
      ctx.globalAlpha=i===0?1:.42;
      ctx.beginPath();
      ctx.arc(px,py,i===0?5:2.4,0,Math.PI*2);
      ctx.fill();
    });
    ctx.globalAlpha=1;
  }

  function renderHealth(ch,hw){
    if(!ch){
      ['#zExp','#zMeas','#ampErr','#health'].forEach(x=>$(x).textContent='—');
      return;
    }

    const expected=hw.z;
    const measured=fault ? expected*2.4 : expected*(1+.03*Math.sin(ch.fc/70));
    const ampError=fault ? 18 : ($('#preEQ').checked ? 2.1 : 7.8);

    $('#zExp').textContent=expected.toFixed(0)+' Ω';
    $('#zMeas').textContent=measured.toFixed(0)+' Ω';
    $('#ampErr').textContent=ampError.toFixed(1)+'%';
    $('#health').textContent=fault?'FAULT':'OK';
  }

  function renderGates(ch,hw,res){
    const vals={
      g1:hw.fs>=8?'PASS':'RISK',
      g2:ch?'PASS':'BLOCKED',
      g3:res.feasible.length?'PASS':'BLOCKED',
      g4:ch&&ch.energy<=res.budgetJ?'PASS':'BLOCKED',
      g5:fault?'FAULT DETECTED':(ch?'PASS':'—'),
      g6:ch&&ch.bw>=40?'PASS':'—'
    };
    Object.entries(vals).forEach(([k,v])=>$('#'+k).textContent=v);
  }

  function preset(name){
    if(name==='reef'){
      $('#temp').value=24;
      $('#sal').value=35;
      $('#depth').value=40;
      $('#mission').value='resolution';
      $('#range').value=80;
      $('#resolution').value=.08;
      $('#battery').value=180;
      $('#profile').value='high';
      applyProfile();
      fault=false;
    }

    if(name==='range'){
      $('#temp').value=8;
      $('#sal').value=35;
      $('#depth').value=600;
      $('#mission').value='range';
      $('#range').value=200;
      $('#resolution').value=.5;
      $('#battery').value=220;
      $('#profile').value='low';
      applyProfile();
      fault=false;
    }

    if(name==='lowbat'){
      $('#battery').value=20;
      $('#reserve').value=8;
      $('#pings').value=40000;
      $('#mission').value='eco';
      $('#range').value=120;
      $('#resolution').value=.35;
      fault=false;
    }

    if(name==='fault') fault=true;

    $$('input[type=range]').forEach(e=>e.dispatchEvent(new Event('input')));
    run();
  }

  function reset(){
    $('#temp').value=12;
    $('#sal').value=35;
    $('#depth').value=100;
    $('#ph').value=8;
    $('#turb').value=10;
    $('#sea').value=2;
    $('#mission').value='balanced';
    $('#range').value=120;
    $('#resolution').value=.2;
    $('#battery').value=120;
    $('#reserve').value=30;
    $('#pings').value=20000;
    $('#profile').value='mid';
    applyProfile();
    fault=false;
    lastChoice=null;
    $$('input[type=range]').forEach(e=>e.dispatchEvent(new Event('input')));
    run();
  }

  bindReadouts();
  applyProfile();

  $('#profile').addEventListener('change',()=>{applyProfile();run();});
  $('#runBtn').addEventListener('click',run);
  $('#resetBtn').addEventListener('click',reset);
  $('#faultBtn').addEventListener('click',()=>{fault=!fault;run();});
  $$('[data-preset]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.preset)));
  $$('input,select').forEach(e=>e.addEventListener('change',()=>{if(e.id!=='profile') run();}));

  run();
})();