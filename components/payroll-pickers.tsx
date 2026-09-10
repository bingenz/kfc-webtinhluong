'use client';

import {useId,useLayoutEffect,useRef,useState} from 'react';
import {CalendarDays,Clock3} from 'lucide-react';
import {vi} from 'react-day-picker/locale';
import {Calendar} from '@/components/ui/calendar';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';

type PickerProps={label:string;value:string;onChange:(value:string)=>void;disabled?:boolean};
const pad=(value:number)=>String(value).padStart(2,'0');
const ROW_HEIGHT=44;

function Wheel({label,value,count,onChange}:{label:string;value:number;count:number;onChange:(value:number)=>void}){
 const id=useId(),scroller=useRef<HTMLDivElement>(null),reported=useRef<number|null>(null);
 useLayoutEffect(()=>{
  if(scroller.current&&reported.current!==value){scroller.current.scrollTop=value*ROW_HEIGHT;reported.current=value;}
 },[value]);
 function select(next:number){
  const index=Math.max(0,Math.min(count-1,next));
  if(scroller.current)scroller.current.scrollTop=index*ROW_HEIGHT;
  reported.current=index;onChange(index);
 }
 return <div className="time-wheel-column"><span id={id+'-label'} className="time-wheel-label">{label}</span><div className="time-wheel-frame"><div className="time-wheel-highlight" aria-hidden="true"/><div ref={scroller} className="time-wheel" role="listbox" aria-labelledby={id+'-label'} aria-activedescendant={id+'-'+value} tabIndex={0}
 onScroll={e=>{const index=Math.max(0,Math.min(count-1,Math.round(e.currentTarget.scrollTop/ROW_HEIGHT)));if(reported.current!==index){reported.current=index;onChange(index)}}}
 onKeyDown={e=>{const next=e.key==='ArrowDown'?value+1:e.key==='ArrowUp'?value-1:e.key==='Home'?0:e.key==='End'?count-1:undefined;if(next!==undefined){e.preventDefault();select(next)}}}>
 {Array.from({length:count},(_,index)=><div id={id+'-'+index} key={index} role="option" aria-selected={value===index} className="time-wheel-option" onClick={()=>select(index)}>{pad(index)}</div>)}
 </div></div></div>;
}

export function TimePicker({label,value,onChange,disabled}:PickerProps){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(value);
 const [hour,minute]=draft.split(':').map(Number);
 return <Popover modal open={open} onOpenChange={next=>{if(next)setDraft(value);setOpen(next)}}>
  <PopoverTrigger asChild><button type="button" className="temporal-trigger" aria-label={label} disabled={disabled}><span>{value}</span><Clock3 size={18}/></button></PopoverTrigger>
  <PopoverContent aria-label={label} className="temporal-popover time-picker" align="center" collisionPadding={12}>
   <div className="picker-heading"><strong>{label}</strong><span className="picker-value">{draft}</span></div>
   <div className="time-wheels"><Wheel label="Giờ" value={hour} count={24} onChange={h=>setDraft(previous=>pad(h)+':'+previous.split(':')[1])}/><span className="wheel-colon" aria-hidden="true">:</span><Wheel label="Phút" value={minute} count={60} onChange={m=>setDraft(previous=>previous.split(':')[0]+':'+pad(m))}/></div>
   <button type="button" className="btn primary picker-done" onClick={()=>{onChange(draft);setOpen(false)}}>Xong</button>
  </PopoverContent>
 </Popover>;
}

export function DatePicker({label,value,onChange,disabled}:PickerProps){
 const [open,setOpen]=useState(false);
 const [year,month,day]=value.split('-').map(Number);
 const selected=new Date(year,month-1,day,12);
 return <Popover modal open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild><button type="button" className="temporal-trigger" aria-label={label} disabled={disabled}><span>{pad(day)}/{pad(month)}/{year}</span><CalendarDays size={18}/></button></PopoverTrigger>
  <PopoverContent aria-label={label} className="temporal-popover date-picker" align="center" collisionPadding={12}>
   <Calendar mode="single" locale={vi} weekStartsOn={1} selected={selected} defaultMonth={selected} autoFocus
    formatters={{formatCaption:date=>`Tháng ${date.getMonth()+1}/${date.getFullYear()}`,formatWeekdayName:date=>['CN','T2','T3','T4','T5','T6','T7'][date.getDay()]}}
    onSelect={date=>{if(date){onChange(`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`);setOpen(false)}}}/>
  </PopoverContent>
 </Popover>;
}
