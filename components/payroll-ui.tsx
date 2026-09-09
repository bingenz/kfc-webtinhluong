'use client';
import type {ReactNode} from 'react';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription,EmptyMedia} from '@/components/ui/empty';
import {CalendarDays} from 'lucide-react';
export function Field({label,children,className=''}:{label:string;children:ReactNode;className?:string}) {return <label className={'field '+className}><span>{label}</span>{children}</label>}
export function Choose({value,onChange,items,label}:{value:string;onChange:(v:string)=>void;items:{value:string;label:string}[];label:string}) {return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{items.map(x=><SelectItem value={x.value} key={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>}
export function Modal({open,onClose,title,description,children}:{open:boolean;onClose:()=>void;title:string;description:string;children:ReactNode}) {return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className="modal"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{children}</DialogContent></Dialog>}
export function Blank({title,text,action}:{title:string;text:string;action?:ReactNode}){return <Empty className="empty-state"><EmptyHeader><EmptyMedia variant="icon"><CalendarDays size={24}/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{text}</EmptyDescription></EmptyHeader>{action}</Empty>}
