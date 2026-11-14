// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ListExportActions } from '../src/features/exports/list-export-actions';
vi.mock('@/features/finance/financial-privacy',()=>({useFinancialPrivacy:()=>({ready:true,hidden:false})}));
vi.mock('@/components/ui/button',()=>({Button:({children,variant: _variant,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string})=>{void _variant; return <button {...props}>{children}</button>;}}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('list export controls',()=>{
  it('does not export while scope is loading or inaccessible',()=>{
    const load=vi.fn();render(<ListExportActions scopeKey="a" disabled load={load}/>);
    fireEvent.click(screen.getByText('Download CSV'));expect(load).not.toHaveBeenCalled();
  });
  it('cancels in-flight export after scope changes',async()=>{
    let finish!:(value:{title:string;scope:string;filters:string;rows:{Item:string}[]})=>void;
    const load=()=>new Promise<{title:string;scope:string;filters:string;rows:{Item:string}[]}>(resolve=>{finish=resolve;});
    const {rerender}=render(<ListExportActions scopeKey="branch-a" disabled={false} load={load}/>);
    fireEvent.click(screen.getByText('Download CSV'));
    rerender(<ListExportActions scopeKey="branch-b" disabled={false} load={load}/>);
    finish({title:'Stock',scope:'a',filters:'all',rows:[{Item:'Fan'}]});
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('cancelled'));
  });
});
