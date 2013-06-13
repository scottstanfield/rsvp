open:
	(sleep 1 && open http://localhost:3000/hash/rsvp) &
	node app.js 



.PHONY: open
