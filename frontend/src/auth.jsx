import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {api} from './api';
const AuthContext=createContext(null);
export function AuthProvider({children}){
  const [user,setUser]=useState(()=>{try{return JSON.parse(localStorage.getItem('campus_user'))||null}catch{return null}});
  const [loading,setLoading]=useState(Boolean(localStorage.getItem('campus_token')));
  useEffect(()=>{if(!localStorage.getItem('campus_token')){setLoading(false);return;} api.get('/auth/me').then(r=>setUser(r.data)).catch(()=>logout()).finally(()=>setLoading(false));},[]);
  function logout(){localStorage.removeItem('campus_token');localStorage.removeItem('campus_user');setUser(null);}
  async function login(email,password){const r=await api.post('/auth/login',{email,password}); localStorage.setItem('campus_token',r.data.token); localStorage.setItem('campus_user',JSON.stringify(r.data.user)); setUser(r.data.user); return r.data.user;}
  const value=useMemo(()=>({user,loading,login,logout}),[user,loading]); return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>useContext(AuthContext);
