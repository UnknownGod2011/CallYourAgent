"use client";
import { useState } from "react"; import { useRouter } from "next/navigation";
export function RefreshCall({id, terminal}:{id:string;terminal:boolean}){const router=useRouter();const[loading,setLoading]=useState(false);async function refresh(){setLoading(true);await fetch(`/api/calls/${id}/sync`,{method:"POST"});setLoading(false);router.refresh();}return <button className="button button-secondary" onClick={refresh} disabled={loading||terminal}>{loading?"Refreshing…":terminal?"Call finalized":"Refresh status"}</button>}
