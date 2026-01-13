#!/usr/bin/env python3
F=len
A=print
import requests as H,zlib as I,sys as B
J='https://curseforge.overwolf.com/electron/linux/CurseForge-0.198.1-21.AppImage'
D=82926761
K=84196
def E():
	try:
		A(f"getting curseforge api key from {J}...");A(f"requesting bytes {D}-{D+K}...");S=f"bytes={D}-{D+K}";T={'Range':S};L=H.get(J,headers=T,timeout=30);L.raise_for_status();M=L.content;A(f"downloaded {F(M)} bytes (compressed)")
		try:V=I.decompress(M)
		except I.error as C:A(f"decompression error: {C}",file=B.stderr);return
		A(f"decompressed to {F(V)} bytes");G=b'"cfCoreApiKey":"';N=V.find(G)
		if N==-1:A(f"couldnt find string {G.decode()}",file=B.stderr);return
		O=N+F(G);P=V.find(b'"',O)
		if P==-1:A("no closing quote",file=B.stderr);return
		Q=V[O:P].decode('utf-8');A(f"api key: {Q}");return Q
	except H.RequestException as C:A(f"network error: {C}",file=B.stderr);return
	except Exception as C:A(f"error: {C}",file=B.stderr);return
if __name__=='__main__':
	C=E()
	if C:B.exit(0)
	else:A('failed to extract api key',file=B.stderr);B.exit(1)
