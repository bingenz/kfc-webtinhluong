'use client';
import {cloneElement,isValidElement,useId,type ReactElement,type ReactNode} from 'react';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from '@/components/ui/dialog';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription,EmptyMedia} from '@/components/ui/empty';
import {CalendarDays,X} from 'lucide-react';
export function Field({label,children,className=''}:{label:string;children:ReactNode;className?:string}) {
  const labelId=useId();
  const inputId=useId();
  let control=children;
  if(isValidElement(children)&&typeof children.type==='string'&&['input','textarea','select'].includes(children.type)){
    const child=children as ReactElement<Record<string,unknown>>;
    const props=child.props as Record<string,unknown>;
    control=cloneElement(child,{id:(props.id as string|undefined)??inputId,'aria-labelledby':props['aria-label']?props['aria-labelledby']:(props['aria-labelledby']??labelId)});
  }
  return <div className={'field '+className}><span id={labelId}>{label}</span>{control}</div>;
}
export function Choose({value,onChange,items,label}:{value:string;onChange:(v:string)=>void;items:{value:string;label:string}[];label:string}) {return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{items.map(x=><SelectItem value={x.value} key={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>}
export function Modal({open,onClose,title,description,children}:{open:boolean;onClose:()=>void;title:string;description:string;children:ReactNode}) {return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className="modal" showCloseButton={false}><DialogClose asChild><button type="button" aria-label="Đóng cửa sổ" className="modal-close"><X size={18}/></button></DialogClose><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{children}</DialogContent></Dialog>}
export function Blank({title,text,action}:{title:string;text:string;action?:ReactNode}){return <Empty className="empty-state"><EmptyHeader><EmptyMedia variant="icon"><CalendarDays size={24}/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{text}</EmptyDescription></EmptyHeader>{action}</Empty>}
