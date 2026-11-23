# Rust でのデータ表現 {#data-representation-in-rust}

低レベルプログラミングでは、データレイアウトがとても気になります。これは大ごとです。
しかも、言語のほかの部分にも広く影響します。そこで、まずは Rust でデータがどう表現されるかを
掘り下げるところから始めます。

理想を言えば、この章は [The Reference の Type Layout の節][ref-type-layout]と内容が一致し、
それによって不要になっているはずです。この本が最初に書かれたころ、The Reference は
まったく手入れされておらず、The Rustonomicon がその一部を代わりに担おうとしていました。
今はもうそうではないので、理想を言えば、この章はまるごと削除できます。

この章はもうしばらく残しておきますが、新しい事実や改善は、できれば The Reference のほうに
寄せてください。

[ref-type-layout]: https://doc.rust-lang.org/reference/type-layout.html
