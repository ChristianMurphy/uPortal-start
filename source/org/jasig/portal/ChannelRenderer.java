/**
 * Copyright � 2001 The JA-SIG Collaborative.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the
 *    distribution.
 *
 * 3. Redistributions of any form whatsoever must retain the following
 *    acknowledgment:
 *    "This product includes software developed by the JA-SIG Collaborative
 *    (http://www.jasig.org/)."
 *
 * THIS SOFTWARE IS PROVIDED BY THE JA-SIG COLLABORATIVE "AS IS" AND ANY
 * EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE JA-SIG COLLABORATIVE OR
 * ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

package org.jasig.portal;

import org.xml.sax.*;
import org.jasig.portal.utils.*;
import java.util.Map;


/**
 * This class renders channel content into a SAXBuffer.
 * Rendering is done in a separate thread.
 * @author Peter Kharchenko
 * @version $ Revision: 1.0 $
 */
public class ChannelRenderer
{
    public static final boolean POOL_THREADS=true;
    public static final boolean CACHE_CHANNELS=true;

    public static final int RENDERING_SUCCESSFUL=0;
    public static final int RENDERING_FAILED=1;
    public static final int RENDERING_TIMED_OUT=2;


    protected IChannel channel;
    protected ChannelRuntimeData rd;
    protected Map channelCache;
    protected Map cacheTables;
    
    protected boolean rendering;
    protected boolean donerendering;
    
    protected Thread workerThread;
    protected ThreadPoolReceipt workerReceipt;

    protected Worker worker;
    
    protected long startTime;
    protected long timeOut = java.lang.Long.MAX_VALUE;

    protected static ThreadPool tp=null;
    protected static Map systemCache=null;

  /**
   * Default constructor.
   * @param chan Channel associated with this ChannelRenderer
   */
  public ChannelRenderer (IChannel chan,ChannelRuntimeData runtimeData)
  {
    this.channel=chan;
    this.rd=runtimeData;
    rendering = false;
    if(tp==null && POOL_THREADS) {
	ResourceLimits rl=new ResourceLimits();
	rl.setOptimalSize(100); // should be on the order of concurrent users
	// note the lack of an upper limit
	tp=new ThreadPool("renderers",rl);
    }
    if(systemCache==null) {
	systemCache=ChannelManager.systemCache;
    }
  }

    Map getChannelCache() {
	if(channelCache==null) {
	    if((channelCache=(SoftHashMap)cacheTables.get(channel))==null) {
		channelCache=new SoftHashMap(1);
		cacheTables.put(channel,channelCache);
	    }
	}
	return channelCache;
    }

  /**
   * Set the timeout value
   * @param value timeout in milliseconds
   */
  public void setTimeout (long value)
  {
    timeOut = value;
  }

    public void setCacheTables(Map cacheTables) {
	this.cacheTables=cacheTables;
    }

  /**
   * Start rendering of the channel in a new thread.
   * Note that rendered information will be accumulated in a
   * buffer until outputRendering() function is called.
   * startRendering() is a non-blocking function.
   */
  public void startRendering ()
  {
    // start the rendering thread

    worker = new Worker (channel,rd);
    if(POOL_THREADS) {
	// use thread pooling
	try {
	    workerReceipt=tp.execute(worker);
	} catch (InterruptedException ie) {
	    Logger.log(Logger.ERROR,"ChannelRenderer::startRendering() : interupted while waiting for a rendering thread!");
	}
    } else {
	workerThread = new Thread (this.worker);
	workerThread.start ();
    }
    rendering = true;
    startTime = System.currentTimeMillis ();
  }

  /**
   * Output channel rendering through a given DocumentHandler.
   * Note: call of outputRendering() without prior call to startRendering() is equivalent to
   * sequential calling of startRendering() and then outputRendering().
   * outputRendering() is a blocking function. It will return only when the channel completes rendering
   * or fails to render by exceeding allowed rendering time.
   * @param out Document Handler that will receive information rendered by the channel.
   * @return error code. 0 - successful rendering; 1 - rendering failed; 2 - rendering timedOut;
   */
  public int outputRendering (DocumentHandler out) throws Exception
  {


    if (!rendering)
      this.startRendering ();

    boolean abandoned=false;
    try
    {
      long wait = timeOut - System.currentTimeMillis () + startTime;

      if(POOL_THREADS) {
	  synchronized(workerReceipt) {
	      if(wait>0 && !workerReceipt.isJobdone())
		  workerReceipt.wait(wait);
	  }
      } else {
	  if (wait > 0)
	      workerThread.join (wait);
      }
    }
    catch (InterruptedException e)
    {
      Logger.log (Logger.DEBUG, "ChannelRenderer::outputRendering() : thread waiting on the WorkerThread has been interrupted : "+e);
    }

    // by this point, if the job is not done, we have to kill it.
    // peterk: would be nice to put it on a "death row" instead of
    // stop()ing it instantly. (sorry for the analogy). That way
    // we could try poking it with interrupt() a few times, give it
    // a low priority and see if it can come back up. stop() can 
    // leave the system in an unstable state :(
    if(POOL_THREADS) {
	synchronized(workerReceipt) {
	    if(!workerReceipt.isJobdone()) {
		workerReceipt.killJob();
		abandoned=true;
		Logger.log(Logger.DEBUG,"ChannelRenderer::outputRendering() : killed.");
	    } else {
		abandoned=!workerReceipt.isJobsuccessful();
	    }
	}
    } else {
	if(!worker.done()) {
	    // kill the working thread
	    // yes, this is terribly crude and unsafe, but I don't see an alternative
	    workerThread.stop ();
	    abandoned=true;
	}
    }

    
    if (!abandoned && worker.done ()) 
    {
	SAXBufferImpl buffer;
      if (worker.successful() && ((buffer=worker.getBuffer())!=null))
      {
        // unplug the buffer :)
        try
        {
	    buffer.outputBuffer(out);
            return RENDERING_SUCCESSFUL;
        }
        catch (SAXException e) {
            // worst case scenario: partial content output :(
            Logger.log (Logger.ERROR, "ChannelRenderer::outputRendering() : following SAX exception occured : "+e);
            throw e;
        }
      } else {
          // rendering was not successful
          Exception e;
          if((e=worker.getException())!=null) throw new InternalPortalException(e);
          // should never get there, unless thread.stop() has seriously messed things up for the worker thread.
          return RENDERING_FAILED;
      }
    } else {
        // rendering has timed out
        return RENDERING_TIMED_OUT;
    }
  }

  /**
   * I am not really sure if this will take care of the runaway rendering threads.
   * The alternative is kill them explicitly in ChannelManager.
   */
    protected void finalize () throws Throwable
    {
	if(POOL_THREADS) {
	    if(workerReceipt!=null && !workerReceipt.isJobdone())
		workerReceipt.killJob();
	} else {
	    if (workerThread.isAlive ())
		workerThread.stop ();
	}
        super.finalize ();
    }

    protected class Worker implements Runnable {
        private boolean successful;
        private boolean done;
        private IChannel channel;
        private ChannelRuntimeData rd;
	private SAXBufferImpl buffer;
        private Exception exc=null;

	protected class ChannelCacheEntry {
	    private final SAXBufferImpl buffer;
	    private final Object validity;
	    public ChannelCacheEntry() {
		buffer=null;
		validity=null;
	    }
	    public ChannelCacheEntry(SAXBufferImpl buffer,Object validity) {
		this.buffer=buffer;
		this.validity=validity;
	    }
	}

        public Worker (IChannel ch, ChannelRuntimeData runtimeData) {
            this.channel=ch;  this.rd=runtimeData;
	    buffer=null;
        }

        public void run () {
            successful = false;
            done = false;

            try {
                if(rd!=null)
                    channel.setRuntimeData(rd);
		
		if(CACHE_CHANNELS) {
		    // try to obtain rendering from cache
		    if(channel instanceof ICacheable ) {
			ChannelCacheKey key=((ICacheable)channel).generateKey();
			if(key!=null) {
			    if(key.getKeyScope()==ChannelCacheKey.SYSTEM_KEY_SCOPE) {
				ChannelCacheEntry entry=(ChannelCacheEntry)systemCache.get(key.getKey());
				if(entry!=null) {
				    // found cached page
				    // check page validity
				    if(((ICacheable)channel).isCacheValid(entry.validity) && (entry.buffer!=null)) {
					// use it
					buffer=entry.buffer;
					Logger.log(Logger.DEBUG,"ChannelRenderer.Worker::run() : retrieved system-wide cached content based on a key \""+key.getKey()+"\"");
				    } else {
					// remove it
					systemCache.remove(key.getKey());
					Logger.log(Logger.DEBUG,"ChannelRenderer.Worker::run() : removed system-wide unvalidated cache based on a key \""+key.getKey()+"\"");
				    }
				}
			    } else {
				// by default we assume INSTANCE_KEY_SCOPE
				ChannelCacheEntry entry=(ChannelCacheEntry)getChannelCache().get(key.getKey());
				if(entry!=null) {
				    // found cached page
				    // check page validity
				    if(((ICacheable)channel).isCacheValid(entry.validity) && (entry.buffer!=null)) {
					// use it
					buffer=entry.buffer;
					Logger.log(Logger.DEBUG,"ChannelRenderer.Worker::run() : retrieved instance-cached content based on a key \""+key.getKey()+"\"");
				    } else {
					// remove it
					getChannelCache().remove(key.getKey());
					Logger.log(Logger.DEBUG,"ChannelRenderer.Worker::run() : removed unvalidated instance-cache based on a key \""+key.getKey()+"\"");
				    }
				}
			    } 
			}
			
			if(buffer==null) {
			    // need to render again and cache the output
			    buffer = new SAXBufferImpl ();
			    buffer.startBuffering();
			    channel.renderXML (buffer);
			    
			    // save cache
			    if(key!=null) {
				if(key.getKeyScope()==ChannelCacheKey.SYSTEM_KEY_SCOPE) {
				    systemCache.put(key.getKey(),new ChannelCacheEntry(buffer,key.getKeyValidity()));
				    Logger.log(Logger.DEBUG,"ChannelRenderer.Worker::run() : recorded system cache based on a key \""+key.getKey()+"\"");
				} else {
				    getChannelCache().put(key.getKey(),new ChannelCacheEntry(buffer,key.getKeyValidity()));
				    Logger.log(Logger.DEBUG,"ChannelRenderer.Worker::run() : recorded instance cache based on a key \""+key.getKey()+"\"");
				}
			    }
			}
		    } else {
			buffer = new SAXBufferImpl ();
			buffer.startBuffering();
			channel.renderXML (buffer);
		    }
		} else  {
		    // in the case when channel cache is not enabled
		    buffer = new SAXBufferImpl ();
		    buffer.startBuffering();
		    channel.renderXML (buffer);
		}
                successful = true;
            } catch (Exception e) {
                this.exc=e;
            }
            done = true;
        }

        public boolean successful () {
            return this.successful;
        }

	public SAXBufferImpl getBuffer() {
	    return this.buffer;
	}

        public boolean done () {
            return this.done;
        }

        public Exception getException() {
            return exc;
        }

    }
}
