'use client';
import { ShoppingBag, User, LogOut, Settings, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const handleLogout = () => {
    logout();
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-black/40 border-b border-white/10">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white">
            <ShoppingBag size={18} />
          </div>
          GraphQL Commerce
        </Link>
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link href="/products">Products</Link>
          </Button>
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 text-slate-200 hover:text-white"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-medium">
                    {user?.firstname?.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline">{user?.firstname}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-100">
                      {user?.firstname} {user?.lastname}
                    </span>
                    <span className="text-xs text-slate-400">
                      {user?.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/profile')}>
                  <User size={16} />
                  My Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/profile/edit')}>
                  <Settings size={16} />
                  Edit Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <LogOut size={16} />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Login</Link>
              </Button>
              <Button variant="default" asChild>
                <Link href="/register" className="flex items-center gap-2">
                  <User size={16} />
                  Join
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
