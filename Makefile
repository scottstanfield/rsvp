open:
	(sleep 1 && open http://localhost:3000/readdb) &
	node app.js 



.PHONY: open
