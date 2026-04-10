import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';

const Root = AlertDialogPrimitive.Root;
const Trigger = AlertDialogPrimitive.Trigger;
const Portal = AlertDialogPrimitive.Portal;

import Content from './alert-dialog-content.svelte';
import Header from './alert-dialog-header.svelte';
import Footer from './alert-dialog-footer.svelte';
import Title from './alert-dialog-title.svelte';
import Description from './alert-dialog-description.svelte';
import Action from './alert-dialog-action.svelte';
import Cancel from './alert-dialog-cancel.svelte';

export {
	Root,
	Trigger,
	Portal,
	Content,
	Header,
	Footer,
	Title,
	Description,
	Action,
	Cancel,
	//
	Root as AlertDialog,
	Trigger as AlertDialogTrigger,
	Portal as AlertDialogPortal,
	Content as AlertDialogContent,
	Header as AlertDialogHeader,
	Footer as AlertDialogFooter,
	Title as AlertDialogTitle,
	Description as AlertDialogDescription,
	Action as AlertDialogAction,
	Cancel as AlertDialogCancel
};
