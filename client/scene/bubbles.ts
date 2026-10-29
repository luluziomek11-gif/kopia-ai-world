interface Bubble {
  element: HTMLDivElement; paragraph: HTMLParagraphElement; next: HTMLButtonElement; count: HTMLElement;
  pages: string[]; page: number; expires: number; x: number; y: number;
}

/** Dialogue lives in screen space: camera zoom never shrinks text. */
export class BubbleLayer {
  private layer: HTMLDivElement;
  private bubbles = new Map<string,Bubble>();
  constructor(parent: HTMLElement) {
    this.layer=document.createElement('div'); this.layer.className='bubble-layer'; parent.append(this.layer);
  }
  private paginate(text:string):string[] {
    // At most four measured lines, including long words. Never discard message text.
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d')!;
    context.font='13px Arial';
    const width=Math.min(288,window.innerWidth-34)-28;
    const linesPerPage=Math.max(2,Math.min(4,Math.floor((window.innerHeight-220)/20)));
    const lines:string[]=[]; let line='';
    for(let word of text.trim().split(/\s+/)) {
      if(line && context.measureText(line+' '+word).width>width){lines.push(line);line='';}
      while(context.measureText(word).width>width){
        let take=1; while(take<word.length && context.measureText(word.slice(0,take+1)).width<=width)take++;
        if(line){lines.push(line);line='';}
        lines.push(word.slice(0,take));word=word.slice(take);
      }
      if(word)line+=(line?' ':'')+word;
    }
    if(line)lines.push(line);
    const pages:string[]=[];
    for(let i=0;i<lines.length;i+=linesPerPage)pages.push(lines.slice(i,i+linesPerPage).join('\n'));
    return pages.length?pages:['…'];
  }
  show(id:string,name:string,text:string,persistent=false):void {
    this.hide(id);
    const element=document.createElement('div'); element.className='pixel-bubble';element.dataset.speaker=id;
    element.setAttribute('role','group');element.setAttribute('aria-label','Wypowiedź: '+name);
    const header=document.createElement('div');header.className='bubble-header';
    const title=document.createElement('strong');title.textContent=name;
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Zamknij dymek '+name);close.onclick=()=>this.hide(id);
    header.append(title,close);
    const paragraph=document.createElement('p');paragraph.className='bubble-text';
    const footer=document.createElement('div');footer.className='bubble-footer';
    const count=document.createElement('span'),next=document.createElement('button');next.setAttribute('aria-label','Dalszy ciąg wypowiedzi '+name);
    footer.append(count,next);element.append(header,paragraph,footer);this.layer.append(element);
    const bubble:Bubble={element,paragraph,next,count,pages:this.paginate(text),page:0,expires:persistent?Infinity:performance.now()+90000,x:0,y:0};
    this.bubbles.set(id,bubble);
    const render=()=>{
      paragraph.textContent=bubble.pages[bubble.page];
      count.textContent=bubble.pages.length>1?(bubble.page+1)+' / '+bubble.pages.length:'';
      next.textContent=bubble.page<bubble.pages.length-1?'Dalej ›':'OK';
    };
    next.onclick=()=>{if(bubble.page<bubble.pages.length-1){bubble.page++;bubble.expires=persistent?Infinity:performance.now()+90000;render();}else this.hide(id);};
    element.addEventListener('pointerdown',e=>e.stopPropagation());render();
  }
  position(id:string,x:number,y:number):void {const b=this.bubbles.get(id);if(b){b.x=x;b.y=y;}}
  layout():void {
    const occupied:{left:number;top:number;width:number;height:number}[]=[];
    const width=window.innerWidth,height=window.innerHeight;
    const newest=[...this.bubbles.keys()].at(-1);
    for(const[id,b]of this.bubbles){
      if(performance.now()>b.expires){this.hide(id);continue;}
      b.element.hidden=(width<520&&id!==newest)||b.x<-60||b.x>width+60||b.y<-100||b.y>height+60;
      if(b.element.hidden)continue;
      const w=b.element.offsetWidth,h=b.element.offsetHeight;
      let left=Math.max(12,Math.min(width-w-12,b.x-w/2));
      let top=Math.max(76,Math.min(height-h-80,b.y-h-17));
      for(const r of occupied)if(left<r.left+r.width+12&&left+w>r.left-12&&top<r.top+r.height+12&&top+h>r.top-12){
        if(r.left-w-14>=12)left=r.left-w-14;
        else if(r.left+r.width+w+14<=width)left=r.left+r.width+14;
        else if(r.top-h-14>=76)top=r.top-h-14;
        else {b.element.hidden=id!==newest;}
      }
      b.element.style.setProperty('--tail-x',Math.round(Math.max(20,Math.min(w-30,b.x-left)))+'px');
      b.element.style.transform='translate('+Math.round(left)+'px,'+Math.round(top)+'px)';
      occupied.push({left,top,width:w,height:h});
    }
  }
  hide(id:string):void {this.bubbles.get(id)?.element.remove();this.bubbles.delete(id);}
  destroy():void {this.bubbles.clear();this.layer.remove();}
}
