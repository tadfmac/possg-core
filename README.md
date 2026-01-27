# possg-core

シンプルなBLOG向けSSGのCOREです。    
まだ開発中です。    

## 概要

- zipによる入稿 (markdownと画像をフォルダに入れて固めてインポート)
- front matter付きmarkdownからHTMLを出力
- jsonファイルDBを利用。簡単に設置できます。

## 機能概要

### 1. PossgCore.import(zipfile)

- zipファイルを指定して記事を1件入稿します。
- zipファイル名(`.zip`を除く)が記事のレコードkeyになります。
- すでに登録されているレコードと同じzipファイルを指定してimport すると既存レコードに上書き更新されます。
- importした記事は staging 状態となります。

### 2. PossgCore.remove(key)

- レコードkeyを指定して1件記事を削除します。

### 3. PossgCore.removeAll()

- 記事を全件削除します。

### 4. PossgCore.publish(key,isRelease)

- レコードkeyを指定して記事のリリース状態を変更します。

### 5. PossgCore.buildAll()

- DBに登録されている情報を元に、記事を再生成します。

> template更新後に記事を再生成したい場合などにご利用ください。

## 利用方法（開発中）

現在開発中のため、まだ npm package には登録していません。    
下記手順でご利用ください。    

```
git clone https://github.com/tadfmac/possg-core.git
cd possg-core
npm i
npm link
```

他のpossgアプリからこのcoreを利用するには、
possgアプリのディレクトリ配下で下記コマンドを実行してください。

```
npm link possg-core
```

## ライセンス

MIT




